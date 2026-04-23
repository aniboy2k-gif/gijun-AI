import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import {
  appendAuditEvent,
  tailAuditEvents,
  AuditEventSchema,
  verifyChain,
} from '@gijun-ai/core'
import { requireToken } from '../middleware/auth.js'

export const auditRouter: ReturnType<typeof Router> = Router()

const appendHandler: RequestHandler = (req, res, next) => {
  try {
    const input = AuditEventSchema.parse(req.body)
    const id = appendAuditEvent(input)
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

const TailQuery = z.object({
  n: z.coerce.number().int().min(1).max(200).default(20),
})

const tailHandler: RequestHandler = (req, res, next) => {
  try {
    const { n } = TailQuery.parse(req.query)
    res.json(tailAuditEvents(n))
  } catch (err) { next(err) }
}

const integrityHandler: RequestHandler = (_req, res, next) => {
  try {
    const result = verifyChain()
    res.status(result.valid ? 200 : 409).json(result)
  } catch (err) { next(err) }
}

auditRouter.post('/', requireToken, appendHandler)
auditRouter.get('/', requireToken, tailHandler)
auditRouter.get('/integrity-check', requireToken, integrityHandler)
