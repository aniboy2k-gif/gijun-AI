import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { requireToken } from '../middleware/auth.js'
import { reportIncident, listIncidents, listCandidatePatterns, approvePatternPromotion, LIST_MAX_LIMIT } from '@gijun-ai/core'

export const incidentsRouter: ReturnType<typeof Router> = Router()

const HASH_PARAM = z.string().regex(/^[a-f0-9]{8,64}$/)

const ListQuery = z.object({
  status: z.enum(['open', 'resolved', 'closed']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
})

const PatternsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
})

const IncidentBody = z.object({
  title: z.string().min(1).max(256),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  aiService: z.string().max(64).optional(),
  taskId: z.number().int().positive().optional(),
  playbookId: z.number().int().positive().optional(),
  description: z.string().min(1).max(4096),
  rootCause: z.string().max(4096).optional(),
  resolution: z.string().max(4096).optional(),
  preventionRule: z.string().max(1024).optional(),
})

const listHandler: RequestHandler = (req, res, next) => {
  try {
    const q = ListQuery.parse(req.query)
    const opts: { status?: string; severity?: string; limit?: number } = {}
    if (q.status !== undefined) opts.status = q.status
    if (q.severity !== undefined) opts.severity = q.severity
    if (q.limit !== undefined) opts.limit = q.limit
    res.json(listIncidents(opts))
  } catch (err) { next(err) }
}

const createHandler: RequestHandler = (req, res, next) => {
  try {
    const parsed = IncidentBody.parse(req.body ?? {})
    const id = reportIncident(parsed)
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

const listPatternsHandler: RequestHandler = (req, res, next) => {
  try {
    const q = PatternsQuery.parse(req.query)
    const opts: { limit?: number } = {}
    if (q.limit !== undefined) opts.limit = q.limit
    res.json(listCandidatePatterns(opts))
  } catch (err) { next(err) }
}

const approvePatternHandler: RequestHandler = (req, res, next) => {
  try {
    const hash = HASH_PARAM.parse(req.params['hash'])
    approvePatternPromotion(hash)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

incidentsRouter.get('/', requireToken, listHandler)
incidentsRouter.post('/', requireToken, createHandler)
incidentsRouter.get('/patterns', requireToken, listPatternsHandler)
incidentsRouter.post('/patterns/:hash/approve', requireToken, approvePatternHandler)
