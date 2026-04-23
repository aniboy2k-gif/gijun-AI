import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { reportIncident, listIncidents, listCandidatePatterns, approvePatternPromotion } from '@gijun-ai/core'

export const incidentsRouter: ReturnType<typeof Router> = Router()

const listHandler: RequestHandler = (req, res, next) => {
  try {
    const { status, severity, limit } = req.query
    const opts: { status?: string; severity?: string; limit?: number } = {}
    if (status) opts.status = status as string
    if (severity) opts.severity = severity as string
    if (limit) opts.limit = parseInt(limit as string, 10)
    res.json(listIncidents(opts))
  } catch (err) { next(err) }
}

const createHandler: RequestHandler = (req, res, next) => {
  try {
    const id = reportIncident(req.body)
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

const listPatternsHandler: RequestHandler = (_req, res, next) => {
  try {
    res.json(listCandidatePatterns())
  } catch (err) { next(err) }
}

const approvePatternHandler: RequestHandler = (req, res, next) => {
  try {
    const hash = req.params['hash'] as string
    approvePatternPromotion(hash)
    res.json({ ok: true })
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string }
    if (e.code === 'NOT_FOUND') { res.status(404).json({ error: { code: 'NOT_FOUND', message: e.message } }); return }
    if (e.code === 'ALREADY_PROMOTED') { res.status(409).json({ error: { code: 'ALREADY_PROMOTED', message: e.message } }); return }
    next(err)
  }
}

// Static /patterns must be before dynamic /:id
incidentsRouter.get('/', requireToken, listHandler)
incidentsRouter.post('/', requireToken, createHandler)
incidentsRouter.get('/patterns', requireToken, listPatternsHandler)
incidentsRouter.post('/patterns/:hash/approve', requireToken, approvePatternHandler)
