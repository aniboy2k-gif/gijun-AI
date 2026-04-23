import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { createPolicy, evaluatePolicy, listPolicies, setPolicyActive } from '@gijun-ai/core'

export const policiesRouter: ReturnType<typeof Router> = Router()

const listHandler: RequestHandler = (_req, res, next) => {
  try {
    res.json(listPolicies())
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
    const { toolName, actionType, resource, taskId } = req.body as {
      toolName: string; actionType: 'read' | 'write' | 'execute' | 'delete'
      resource?: string; taskId?: number
    }
    const result = evaluatePolicy(toolName, actionType, resource, taskId)
    res.json({ result })
  } catch (err) { next(err) }
}

const setActiveHandler = (active: boolean): RequestHandler => (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string, 10)
    if (isNaN(id)) { res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid policy id' } }); return }
    setPolicyActive(id, active)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

policiesRouter.get('/', requireToken, listHandler)
policiesRouter.post('/', requireToken, createHandler)
policiesRouter.post('/evaluate', requireToken, evaluateHandler)
policiesRouter.post('/:id/activate', requireToken, setActiveHandler(true))
policiesRouter.post('/:id/deactivate', requireToken, setActiveHandler(false))
