import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { getDb } from '../db/client.js'
import { appendAuditEvent } from '../audit/service.js'
import { CostLimitConditionsSchema } from '../policy/engine.js'
import type { CostEntry } from '../cost/types.js'
import { CONSERVATIVE_ESTIMATE_MICROS_PER_CALL } from '../cost/pricing.js'

export const TraceSchema = z.object({
  taskId: z.number().int().optional(),
  operation: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  inputTokens: z.number().int().default(0),
  outputTokens: z.number().int().default(0),
  costUsd: z.number().default(0),
  latencyMs: z.number().int().default(0),
  genAiSystem: z.string().optional(),
  genAiOperationName: z.string().optional(),
  genAiRequestModel: z.string().optional(),
  genAiResponseFinishReason: z.string().optional(),
  spanData: z.record(z.unknown()).default({}),
})

export type TraceInput = z.input<typeof TraceSchema>

export function recordTrace(traceId: string, input: TraceInput): number {
  const validated = TraceSchema.parse(input)
  const result = getDb().prepare(`
    INSERT INTO traces (
      trace_id, task_id, operation, model, provider,
      input_tokens, output_tokens, cost_usd, latency_ms,
      gen_ai_system, gen_ai_operation_name, gen_ai_request_model,
      gen_ai_response_finish_reason, span_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    traceId,
    validated.taskId ?? null,
    validated.operation ?? null,
    validated.model ?? null,
    validated.provider ?? null,
    validated.inputTokens,
    validated.outputTokens,
    validated.costUsd,
    validated.latencyMs,
    validated.genAiSystem ?? null,
    validated.genAiOperationName ?? null,
    validated.genAiRequestModel ?? null,
    validated.genAiResponseFinishReason ?? null,
    JSON.stringify(validated.spanData),
  )
  return result.lastInsertRowid as number
}

export function generateTraceId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Records a trace from a parsed CostEntry (migration 006+ schema).
 * Uses cost_usd_micros as the canonical cost field; backfills cost_usd for
 * backward-compat with pre-006 callers that read cost_usd directly.
 *
 * @returns the SQLite lastInsertRowid of the new traces row.
 */
export function recordTraceFromCostEntry(
  traceId: string,
  entry: CostEntry,
  extra?: {
    taskId?: number
    operation?: string
    latencyMs?: number
    spanData?: Record<string, unknown>
  },
): number {
  const db = getDb()

  // Derive the legacy cost_usd from micros for backward-compat readers.
  // NULL micros (should not happen in practice) → 0 legacy cost.
  const legacyCostUsd = entry.costUsdMicros != null ? entry.costUsdMicros / 1_000_000 : 0

  const result = db.prepare(`
    INSERT INTO traces (
      trace_id, task_id, operation, model, provider,
      input_tokens, output_tokens, cost_usd, latency_ms,
      span_data,
      parse_status, parse_error, raw_payload_hash, cost_usd_micros, cost_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    traceId,
    extra?.taskId ?? null,
    extra?.operation ?? null,
    entry.model,
    entry.provider,
    entry.inputTokens,
    entry.outputTokens,
    legacyCostUsd,
    extra?.latencyMs ?? 0,
    JSON.stringify(extra?.spanData ?? {}),
    entry.parseStatus,
    entry.parseError ?? null,
    entry.rawPayloadHash ?? null,
    entry.costUsdMicros,
    entry.costSource,
  )
  return result.lastInsertRowid as number
}

type CostSummary = {
  total_cost_usd: number
  total_input_tokens: number
  total_output_tokens: number
  total_calls: number
  avg_latency_ms: number
}

export type BudgetPeriod = '1h' | '24h' | '7d' | '30d' | 'mtd'

/**
 * Resolves a period identifier to its SQL `since` expression.
 * Rolling windows (1h/24h/7d/30d) use negative offsets;
 * anchor periods (mtd) use calendar boundaries in UTC.
 */
function resolveSinceSql(period: BudgetPeriod): string {
  switch (period) {
    case '1h':  return "datetime('now', '-1 hour')"
    case '24h': return "datetime('now', '-24 hours')"
    case '7d':  return "datetime('now', '-7 days')"
    case '30d': return "datetime('now', '-30 days')"
    case 'mtd': return "datetime('now', 'start of month')"
  }
}

export function getCostSummary(period: BudgetPeriod = '24h'): CostSummary {
  const sinceSql = resolveSinceSql(period)
  // cost_usd_micros is canonical (migration 006+). For legacy rows (cost_usd_micros IS NULL),
  // fall back to cost_usd * 1,000,000 to maintain continuity. Result is converted back to USD.
  return getDb().prepare(`
    SELECT
      COALESCE(
        SUM(CASE
          WHEN cost_usd_micros IS NOT NULL THEN cost_usd_micros / 1000000.0
          ELSE cost_usd
        END), 0
      )                                 AS total_cost_usd,
      COALESCE(SUM(input_tokens), 0)   AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0)  AS total_output_tokens,
      COUNT(*)                          AS total_calls,
      COALESCE(AVG(latency_ms), 0)     AS avg_latency_ms
    FROM traces
    WHERE created_at >= ${sinceSql}
  `).get() as CostSummary
}

/**
 * Returns cost breakdown by parse_status for the given period.
 * Used internally by checkBudget to apply conservative estimation for 'failed' traces.
 */
type CostBreakdown = {
  confirmed_micros: number
  failed_count: number
  total_calls: number
}

function getCostBreakdown(period: BudgetPeriod): CostBreakdown {
  const sinceSql = resolveSinceSql(period)
  return getDb().prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN parse_status IN ('success', 'legacy')
        THEN COALESCE(cost_usd_micros, CAST(cost_usd * 1000000 AS INTEGER))
        ELSE 0 END), 0)                AS confirmed_micros,
      COUNT(CASE WHEN parse_status = 'failed' THEN 1 END) AS failed_count,
      COUNT(*)                         AS total_calls
    FROM traces
    WHERE created_at >= ${sinceSql}
  `).get() as CostBreakdown
}

// ===========================================================
// Cost Budget — advisory-only budget status check
// ===========================================================

export type BudgetScope = { toolName: string; resource: string }

export type BudgetStatus =
  | { status: 'no_policy'; queried: { toolName?: string; resource?: string } }
  | { status: 'invalid'; reason: string; policyId: number }
  | { status: 'no_cost_data'; appliedPolicyId: number; scope: BudgetScope; period: BudgetPeriod; limitUsd: number }
  | { status: 'under_budget'; appliedPolicyId: number; scope: BudgetScope; currentUsd: number; limitUsd: number; period: BudgetPeriod }
  | { status: 'warning'; appliedPolicyId: number; scope: BudgetScope; currentUsd: number; limitUsd: number; period: BudgetPeriod; threshold: number }
  | { status: 'critical'; appliedPolicyId: number; scope: BudgetScope; currentUsd: number; limitUsd: number; period: BudgetPeriod; threshold: number }
  | { status: 'over_budget'; appliedPolicyId: number; scope: BudgetScope; currentUsd: number; limitUsd: number; period: BudgetPeriod; overage: number }

type BudgetPolicyRow = {
  id: number
  tool_name: string
  resource: string
  conditions: string
}

const AUDITED_STATUSES = new Set(['invalid', 'warning', 'critical', 'over_budget'])

/**
 * Returns the current advisory budget status. Does NOT enforce anything.
 * Selects the most specific active budget policy matching toolName/resource.
 * Abnormal statuses (invalid/warning/critical/over_budget) are appended to the audit log.
 */
export function checkBudget(opts: { toolName?: string; resource?: string } = {}): BudgetStatus {
  const db = getDb()
  const toolName = opts.toolName ?? '*'
  const resource = opts.resource ?? '*'

  const row = db.prepare(`
    SELECT id, tool_name, resource, conditions FROM policies
    WHERE policy_kind = 'budget'
      AND is_active = 1
      AND (tool_name = ? OR tool_name = '*')
      AND (resource = ? OR resource = '*')
    ORDER BY
      priority DESC,
      CASE WHEN tool_name = ? THEN 1 ELSE 0 END DESC,
      CASE WHEN resource = ? THEN 1 ELSE 0 END DESC,
      created_at DESC
    LIMIT 1
  `).get(toolName, resource, toolName, resource) as BudgetPolicyRow | undefined

  const queried: { toolName?: string; resource?: string } = {}
  if (opts.toolName !== undefined) queried.toolName = opts.toolName
  if (opts.resource !== undefined) queried.resource = opts.resource

  if (!row) {
    return { status: 'no_policy', queried }
  }

  // Parse conditions — if invalid, return { status: 'invalid' }
  let parsed: z.infer<typeof CostLimitConditionsSchema>
  try {
    parsed = CostLimitConditionsSchema.parse(JSON.parse(row.conditions))
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown parse error'
    console.error(`[agentguard] invalid cost_limit policy ${row.id}: ${reason}`)
    const status: BudgetStatus = { status: 'invalid', reason, policyId: row.id }
    auditBudgetStatus(status)
    return status
  }

  const breakdown = getCostBreakdown(parsed.period)
  // Conservative: add CONSERVATIVE_ESTIMATE_MICROS_PER_CALL for each failed trace
  // to avoid silent budget overruns when parse failures hide actual costs.
  const estimatedFailedMicros = breakdown.failed_count * CONSERVATIVE_ESTIMATE_MICROS_PER_CALL
  const currentMicros = breakdown.confirmed_micros + estimatedFailedMicros
  const currentUsd = currentMicros / 1_000_000
  const limitUsd = parsed.usd_limit
  const scope: BudgetScope = { toolName: row.tool_name, resource: row.resource }

  let status: BudgetStatus
  if (breakdown.total_calls === 0) {
    status = { status: 'no_cost_data', appliedPolicyId: row.id, scope, period: parsed.period, limitUsd }
  } else if (currentUsd >= limitUsd) {
    status = { status: 'over_budget', appliedPolicyId: row.id, scope, currentUsd, limitUsd, period: parsed.period, overage: currentUsd - limitUsd }
  } else if (currentUsd >= limitUsd * parsed.critical_threshold) {
    status = { status: 'critical', appliedPolicyId: row.id, scope, currentUsd, limitUsd, period: parsed.period, threshold: parsed.critical_threshold }
  } else if (currentUsd >= limitUsd * parsed.warning_threshold) {
    status = { status: 'warning', appliedPolicyId: row.id, scope, currentUsd, limitUsd, period: parsed.period, threshold: parsed.warning_threshold }
  } else {
    status = { status: 'under_budget', appliedPolicyId: row.id, scope, currentUsd, limitUsd, period: parsed.period }
  }

  auditBudgetStatus(status)
  return status
}

function auditBudgetStatus(status: BudgetStatus): void {
  if (!AUDITED_STATUSES.has(status.status)) return
  appendAuditEvent({
    eventType: `budget.${status.status}`,
    actor: 'system',
    action: `budget check resulted in ${status.status}`,
    resourceType: 'budget',
    resourceId: 'appliedPolicyId' in status ? String(status.appliedPolicyId) : undefined,
    payload: status as unknown as Record<string, unknown>,
  })
}
