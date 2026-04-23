import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { recordTrace, generateTraceId, getCostSummary } from '@gijun-ai/core'
import { z } from 'zod'

export const tracesRouter: ReturnType<typeof Router> = Router()

const SummaryQuery = z.object({
  period: z.enum(['1h', '24h', '7d', '30d', 'mtd']).default('24h'),
})

const summaryHandler: RequestHandler = (req, res, next) => {
  try {
    const { period } = SummaryQuery.parse(req.query)
    res.json(getCostSummary(period))
  } catch (err) { next(err) }
}

const createHandler: RequestHandler = (req, res, next) => {
  try {
    const traceId = (req.body.traceId as string | undefined) ?? generateTraceId()
    const { traceId: _skip, ...rest } = req.body as { traceId?: string; [k: string]: unknown }
    const id = recordTrace(traceId, rest)
    res.status(201).json({ id, traceId })
  } catch (err) { next(err) }
}

tracesRouter.get('/summary', requireToken, summaryHandler)
tracesRouter.post('/', requireToken, createHandler)
