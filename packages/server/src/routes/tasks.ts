import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { createTask, getTask, updateTaskStatus, listTasks, addTaskStep, approveHitl, LIST_MAX_LIMIT } from '@gijun-ai/core'
import { requireToken } from '../middleware/auth.js'

export const tasksRouter: ReturnType<typeof Router> = Router()

const ID_PARAM = z.coerce.number().int().positive()

const CreateTaskBody = z.object({
  title: z.string().min(1).max(512),
  description: z.string().max(4096).optional(),
  complexity: z.enum(['trivial', 'standard', 'complex', 'critical']).default('standard'),
  project: z.string().max(128).optional(),
  tags: z.array(z.string()).default([]),
  toolName: z.string().max(128).optional(),
  actionType: z.enum(['read', 'write', 'execute', 'delete']).optional(),
  resource: z.string().max(512).optional(),
})

const UpdateStatusBody = z.object({
  status: z.enum(['pending', 'in_progress', 'hitl_wait', 'done', 'cancelled']),
})

const ListQuery = z.object({
  project: z.string().max(128).optional(),
  status: z.enum(['pending', 'in_progress', 'hitl_wait', 'done', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
})

const StepBody = z.object({
  stepNo: z.number().int().min(1),
  prompt: z.string().max(16384).optional(),
  response: z.string().max(65536).optional(),
  model: z.string().max(128).optional(),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  costUsd: z.number().min(0).optional(),
  latencyMs: z.number().int().min(0).optional(),
  toolCalls: z.array(z.unknown()).optional(),
})

const createHandler: RequestHandler = (req, res, next) => {
  try {
    const body = CreateTaskBody.parse(req.body ?? {})
    const id = createTask(body)
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

const getHandler: RequestHandler = (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    const task = getTask(id)
    if (!task) { res.status(404).json({ error: 'NOT_FOUND', detail: 'Task not found' }); return }
    res.json(task)
  } catch (err) { next(err) }
}

const updateStatusHandler: RequestHandler = (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    const { status } = UpdateStatusBody.parse(req.body ?? {})
    updateTaskStatus(id, status)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

const listHandler: RequestHandler = (req, res, next) => {
  try {
    const q = ListQuery.parse(req.query)
    const opts: { project?: string; status?: string; limit?: number } = {}
    if (q.project !== undefined) opts.project = q.project
    if (q.status !== undefined) opts.status = q.status
    if (q.limit !== undefined) opts.limit = q.limit
    res.json(listTasks(opts))
  } catch (err) { next(err) }
}

const addStepHandler: RequestHandler = (req, res, next) => {
  try {
    const taskId = ID_PARAM.parse(req.params['id'])
    const parsed = StepBody.parse(req.body ?? {})
    const id = addTaskStep({ taskId, ...parsed })
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

const hitlApproveHandler: RequestHandler = (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    approveHitl(id)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

tasksRouter.get('/', requireToken, listHandler)
tasksRouter.post('/', requireToken, createHandler)
tasksRouter.get('/:id', requireToken, getHandler)
tasksRouter.patch('/:id/status', requireToken, updateStatusHandler)
tasksRouter.post('/:id/steps', requireToken, addStepHandler)
tasksRouter.post('/:id/hitl-approve', requireToken, hitlApproveHandler)
