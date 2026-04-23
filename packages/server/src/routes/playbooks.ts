import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { createPlaybook, updatePlaybook, listPlaybooks, getPlaybook } from '@gijun-ai/core'

export const playbooksRouter: ReturnType<typeof Router> = Router()

const listHandler: RequestHandler = (req, res, next) => {
  try {
    const scope = req.query['scope'] as string | undefined
    res.json(listPlaybooks(scope))
  } catch (err) { next(err) }
}

const createHandler: RequestHandler = (req, res, next) => {
  try {
    const id = createPlaybook(req.body)
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

const getBySlugHandler: RequestHandler = (req, res, next) => {
  try {
    const playbook = getPlaybook(req.params['slug'] as string)
    if (!playbook) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playbook not found' } }); return }
    res.json(playbook)
  } catch (err) { next(err) }
}

const getByIdHandler: RequestHandler = (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string, 10)
    if (isNaN(id)) { res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid playbook id' } }); return }
    const playbook = getPlaybook(id)
    if (!playbook) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playbook not found' } }); return }
    res.json(playbook)
  } catch (err) { next(err) }
}

const updateHandler: RequestHandler = (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string, 10)
    if (isNaN(id)) { res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid playbook id' } }); return }
    const { content, changeNote } = req.body as { content: string; changeNote?: string }
    updatePlaybook(id, { content }, changeNote)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

// Static /slug/:slug must be registered before /:id to avoid conflict
playbooksRouter.get('/', requireToken, listHandler)
playbooksRouter.post('/', requireToken, createHandler)
playbooksRouter.get('/slug/:slug', requireToken, getBySlugHandler)
playbooksRouter.get('/:id', requireToken, getByIdHandler)
playbooksRouter.patch('/:id', requireToken, updateHandler)
