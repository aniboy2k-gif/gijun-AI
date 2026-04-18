import { z } from 'zod'
import { getDb } from '../db/client.js'
import { appendAuditEvent } from '../audit/service.js'

export const PolicySchema = z.object({
  toolName: z.string().min(1),
  resource: z.string().default('*'),
  actionType: z.enum(['read', 'write', 'execute', 'delete']),
  effect: z.enum(['allow', 'deny']).default('allow'),
  rateLimit: z.number().int().optional(),
  conditions: z.record(z.unknown()).default({}),
})

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
  const result = getDb().prepare(`
    INSERT INTO policies (tool_name, resource, action_type, effect, rate_limit, conditions)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    validated.toolName,
    validated.resource,
    validated.actionType,
    validated.effect,
    validated.rateLimit ?? null,
    JSON.stringify(validated.conditions),
  )
  return result.lastInsertRowid as number
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
    WHERE tool_name IN (?, '*')
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
