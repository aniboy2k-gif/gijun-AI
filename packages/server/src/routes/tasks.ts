import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { createTask, getTask, updateTaskStatus, listTasks, addTaskStep, approveHitl } from '@gijun-ai/core'
import { requireToken } from '../middleware/auth.js'

export const tasksRouter: ReturnType<typeof Router> = Router()

const CreateTaskBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  complexity: z.enum(['trivial', 'standard', 'complex', 'critical']).default('standard'),
  project: z.string().optional(),
  tags: z.array(z.string()).default([]),
})

const createHandler: RequestHandler = (req, res, next) => {
  try {
    const body = CreateTaskBody.parse(req.body)
    const id = createTask(body)
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

const getHandler: RequestHandler = (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid task id' }); return }
    const task = getTask(id)
    if (!task) { res.status(404).json({ error: 'Task not found' }); return }
    res.json(task)
  } catch (err) { next(err) }
}

const UpdateStatusBody = z.object({
  status: z.enum(['pending', 'in_progress', 'hitl_wait', 'done', 'cancelled']),
})

const updateStatusHandler: RequestHandler = (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid task id' }); return }
    const { status } = UpdateStatusBody.parse(req.body)
    updateTaskStatus(id, status)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

const listHandler: RequestHandler = (req, res, next) => {
  try {
    const { project, status, limit } = req.query
    const opts: { project?: string; status?: string; limit?: number } = {
      limit: limit ? Math.min(parseInt(limit as string, 10), 200) : 50,
    }
    if (project) opts.project = project as string
    if (status) opts.status = status as string
    res.json(listTasks(opts))
  } catch (err) { next(err) }
}

const addStepHandler: RequestHandler = (req, res, next) => {
  try {
    const taskId = parseInt(req.params['id'] as string, 10)
    if (isNaN(taskId)) { res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid task id' } }); return }
    const id = addTaskStep({ taskId, ...req.body })
    res.status(201).json({ id })
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string }
    if (e.code === 'SQLITE_CONSTRAINT') { res.status(409).json({ error: { code: 'DUPLICATE_STEP', message: 'Step number already exists' } }); return }
    next(err)
  }
}

const hitlApproveHandler: RequestHandler = (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string, 10)
    if (isNaN(id)) { res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid task id' } }); return }
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
