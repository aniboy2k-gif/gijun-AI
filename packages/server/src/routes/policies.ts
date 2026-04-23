import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { requireToken } from '../middleware/auth.js'
import { createPolicy, evaluatePolicy, listPolicies, setPolicyActive, LIST_MAX_LIMIT } from '@gijun-ai/core'

export const policiesRouter: ReturnType<typeof Router> = Router()

const ID_PARAM = z.coerce.number().int().positive()

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
  includeInactive: z.coerce.boolean().optional(),
})

const EvaluateBody = z.object({
  toolName: z.string().min(1).max(128),
  actionType: z.enum(['read', 'write', 'execute', 'delete']),
  resource: z.string().max(512).optional(),
  taskId: z.number().int().positive().optional(),
})

const listHandler: RequestHandler = (req, res, next) => {
  try {
    const q = ListQuery.parse(req.query)
    const opts: { activeOnly?: boolean; limit?: number } = {}
    if (q.limit !== undefined) opts.limit = q.limit
    if (q.includeInactive !== undefined) opts.activeOnly = !q.includeInactive
    res.json(listPolicies(opts))
  } catch (err) { next(err) }
}

const createHandler: RequestHandler = (req, res, next) => {
  try {
    const id = createPolicy(req.body)
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

const evaluateHandler: RequestHandler = (req, res, next) => {
  try {
    const { toolName, actionType, resource, taskId } = EvaluateBody.parse(req.body ?? {})
    const result = evaluatePolicy(toolName, actionType, resource, taskId)
    res.json({ result })
  } catch (err) { next(err) }
}

const setActiveHandler = (active: boolean): RequestHandler => (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    setPolicyActive(id, active)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

policiesRouter.get('/', requireToken, listHandler)
policiesRouter.post('/', requireToken, createHandler)
policiesRouter.post('/evaluate', requireToken, evaluateHandler)
policiesRouter.post('/:id/activate', requireToken, setActiveHandler(true))
policiesRouter.post('/:id/deactivate', requireToken, setActiveHandler(false))
