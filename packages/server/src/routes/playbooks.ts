import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { requireToken } from '../middleware/auth.js'
import { createPlaybook, updatePlaybook, listPlaybooks, getPlaybook, LIST_MAX_LIMIT } from '@gijun-ai/core'

export const playbooksRouter: ReturnType<typeof Router> = Router()

const SLUG_RE = /^[a-z0-9-]{1,64}$/
const ID_PARAM = z.coerce.number().int().positive()
const SLUG_PARAM = z.string().regex(SLUG_RE)

const ListQuery = z.object({
  scope: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
})

const UpdateBody = z.object({
  content: z.string().min(1).optional(),
  title: z.string().min(1).max(256).optional(),
  tags: z.array(z.string()).optional(),
  changeNote: z.string().max(1024).optional(),
}).refine(v => v.content !== undefined || v.title !== undefined || v.tags !== undefined, {
  message: 'at least one of content/title/tags required',
})

const listHandler: RequestHandler = (req, res, next) => {
  try {
    const q = ListQuery.parse(req.query)
    const opts: { scope?: string; limit?: number } = {}
    if (q.scope !== undefined) opts.scope = q.scope
    if (q.limit !== undefined) opts.limit = q.limit
    res.json(listPlaybooks(opts))
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
    const slug = SLUG_PARAM.parse(req.params['slug'])
    const playbook = getPlaybook(slug)
    if (!playbook) { res.status(404).json({ error: 'NOT_FOUND', detail: 'Playbook not found' }); return }
    res.json(playbook)
  } catch (err) { next(err) }
}

const getByIdHandler: RequestHandler = (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    const playbook = getPlaybook(id)
    if (!playbook) { res.status(404).json({ error: 'NOT_FOUND', detail: 'Playbook not found' }); return }
    res.json(playbook)
  } catch (err) { next(err) }
}

const updateHandler: RequestHandler = (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    const parsed = UpdateBody.parse(req.body ?? {})
    const partial: { content?: string; title?: string; tags?: string[] } = {}
    if (parsed.content !== undefined) partial.content = parsed.content
    if (parsed.title !== undefined) partial.title = parsed.title
    if (parsed.tags !== undefined) partial.tags = parsed.tags
    updatePlaybook(id, partial, parsed.changeNote)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

playbooksRouter.get('/', requireToken, listHandler)
playbooksRouter.post('/', requireToken, createHandler)
playbooksRouter.get('/slug/:slug', requireToken, getBySlugHandler)
playbooksRouter.get('/:id', requireToken, getByIdHandler)
playbooksRouter.patch('/:id', requireToken, updateHandler)
