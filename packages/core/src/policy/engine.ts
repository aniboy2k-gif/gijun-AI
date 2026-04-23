import { z } from 'zod'
import { getDb } from '../db/client.js'
import { appendAuditEvent } from '../audit/service.js'

/** Shared across all policy kinds. */
const BasePolicyShape = {
  toolName: z.string().min(1),
  resource: z.string().default('*'),
  priority: z.number().int().min(0).default(0),
} as const

/** Standard allow/deny/rate_limit policies (policy_kind='standard'). */
export const StandardPolicySchema = z.object({
  ...BasePolicyShape,
  policyKind: z.literal('standard').default('standard'),
  actionType: z.enum(['read', 'write', 'execute', 'delete']),
  effect: z.enum(['allow', 'deny']).default('allow'),
  rateLimit: z.number().int().optional(),
  conditions: z.record(z.unknown()).default({}),
})

/** Cost-limit conditions schema for budget policies. */
export const CostLimitConditionsSchema = z.object({
  period: z.enum(['1h', '24h', '7d', '30d', 'mtd']),
  usd_limit: z.number().positive(),
  warning_threshold: z.number().min(0).max(1).default(0.8),
  critical_threshold: z.number().min(0).max(1).default(0.95),
}).refine(
  v => v.critical_threshold > v.warning_threshold,
  { message: 'critical_threshold must be > warning_threshold' },
)

/** Budget (cost_limit) policies (policy_kind='budget'). action_type/effect/rate_limit are forced. */
export const BudgetPolicySchema = z.object({
  ...BasePolicyShape,
  policyKind: z.literal('budget'),
  toolName: z.string().default('*'),  // broader default for global budgets
  conditions: CostLimitConditionsSchema,
})

export const PolicySchema = z.discriminatedUnion('policyKind', [
  StandardPolicySchema,
  BudgetPolicySchema,
])

export type PolicyInput = z.input<typeof PolicySchema>
export type PolicyResult = 'allow' | 'deny' | 'rate_limited'

type PolicyRow = {
  id: number
  tool_name: string
  resource: string
  action_type: string
  effect: string
  rate_limit: number | null
  conditions: string
}

export function createPolicy(input: PolicyInput): number {
  const validated = PolicySchema.parse(input)

  // Budget policies force action_type/effect/rate_limit to inert values;
  // semantics live entirely in conditions + policy_kind='budget'.
  const isBudget = validated.policyKind === 'budget'
  const actionType = isBudget ? 'read' : validated.actionType
  const effect = isBudget ? 'allow' : validated.effect
  const rateLimit = isBudget ? null : (validated.rateLimit ?? null)
  const conditions = validated.conditions

  const result = getDb().prepare(`
    INSERT INTO policies
      (tool_name, resource, action_type, effect, rate_limit, conditions, policy_kind, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    validated.toolName,
    validated.resource,
    actionType,
    effect,
    rateLimit,
    JSON.stringify(conditions),
    validated.policyKind,
    validated.priority,
  )
  return result.lastInsertRowid as number
}

export function setPolicyActive(id: number, active: boolean): void {
  getDb().prepare('UPDATE policies SET is_active = ? WHERE id = ?').run(active ? 1 : 0, id)
  appendAuditEvent({
    eventType: active ? 'policy.activated' : 'policy.deactivated',
    actor: 'human',
    action: `policy ${id} ${active ? 'activated' : 'deactivated'}`,
    resourceType: 'policy',
    resourceId: String(id),
  })
}

export function evaluate(
  toolName: string,
  actionType: 'read' | 'write' | 'execute' | 'delete',
  resource = '*',
  taskId?: number,
): PolicyResult {
  const db = getDb()

  const policies = db.prepare(`
    SELECT * FROM policies
    WHERE policy_kind = 'standard'
      AND tool_name IN (?, '*')
      AND action_type IN (?, '*')
      AND (resource = ? OR resource = '*')
      AND is_active = 1
    ORDER BY effect DESC
  `).all(toolName, actionType, resource) as PolicyRow[]

  let result: PolicyResult = 'allow'

  for (const policy of policies) {
    if (policy.effect === 'deny') {
      result = 'deny'
      break
    }

    if (policy.rate_limit !== null) {
      const recentCount = db.prepare(`
        SELECT COUNT(*) as cnt FROM policy_evaluations
        WHERE tool_name = ? AND action_type = ?
          AND evaluated_at >= datetime('now', '-1 minute')
      `).get(toolName, actionType) as { cnt: number }

      if (recentCount.cnt >= policy.rate_limit) {
        result = 'rate_limited'
        break
      }
    }
  }

  db.prepare(`
    INSERT INTO policy_evaluations (task_id, tool_name, action_type, result)
    VALUES (?, ?, ?, ?)
  `).run(taskId ?? null, toolName, actionType, result)

  if (result !== 'allow') {
    appendAuditEvent({
      eventType: 'policy.blocked',
      action: `${toolName}.${actionType} blocked: ${result}`,
      resourceType: 'policy',
      taskId,
      payload: { toolName, actionType, resource, result },
    })
  }

  return result
}
