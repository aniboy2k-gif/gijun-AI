import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { getDb } from '../db/client.js'

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

type CostSummary = {
  total_cost_usd: number
  total_input_tokens: number
  total_output_tokens: number
  total_calls: number
  avg_latency_ms: number
}

export function getCostSummary(period: '1h' | '24h' | '7d' | '30d' = '24h'): CostSummary {
  const intervals: Record<string, string> = {
    '1h': '-1 hour',
    '24h': '-24 hours',
    '7d': '-7 days',
    '30d': '-30 days',
  }
  const interval = intervals[period] ?? '-24 hours'

  return getDb().prepare(`
    SELECT
      COALESCE(SUM(cost_usd), 0)       AS total_cost_usd,
      COALESCE(SUM(input_tokens), 0)   AS total_input_tokens,
      COALESCE(SUM(output_tokens), 0)  AS total_output_tokens,
      COUNT(*)                          AS total_calls,
      COALESCE(AVG(latency_ms), 0)     AS avg_latency_ms
    FROM traces
    WHERE created_at >= datetime('now', ?)
  `).get(interval) as CostSummary
}
