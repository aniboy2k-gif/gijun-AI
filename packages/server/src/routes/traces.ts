import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { recordTrace, generateTraceId, getCostSummary } from '@gijun-ai/core'
import { z } from 'zod'

export const tracesRouter: ReturnType<typeof Router> = Router()

const SummaryQuery = z.object({
  period: z.enum(['1h', '24h', '7d', '30d', 'mtd']).default('24h'),
})

const TraceBody = z.object({
  traceId: z.string().regex(/^[a-fA-F0-9-]{1,64}$/).optional(),
  taskId: z.number().int().optional(),
  operation: z.string().max(128).optional(),
  model: z.string().max(128).optional(),
  provider: z.string().max(64).optional(),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  costUsd: z.number().min(0).optional(),
  latencyMs: z.number().int().min(0).optional(),
  genAiSystem: z.string().max(128).optional(),
  genAiOperationName: z.string().max(128).optional(),
  genAiRequestModel: z.string().max(128).optional(),
  genAiResponseFinishReason: z.string().max(64).optional(),
  spanData: z.record(z.unknown()).optional(),
})

const summaryHandler: RequestHandler = (req, res, next) => {
  try {
    const { period } = SummaryQuery.parse(req.query)
    res.json(getCostSummary(period))
  } catch (err) { next(err) }
}

const createHandler: RequestHandler = (req, res, next) => {
  try {
    const parsed = TraceBody.parse(req.body ?? {})
    const traceId = parsed.traceId ?? generateTraceId()
    const { traceId: _skip, ...rest } = parsed
    const id = recordTrace(traceId, rest)
    res.status(201).json({ id, traceId })
  } catch (err) { next(err) }
}

tracesRouter.get('/summary', requireToken, summaryHandler)
tracesRouter.post('/', requireToken, createHandler)
