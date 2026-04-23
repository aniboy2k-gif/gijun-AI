import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { z } from 'zod'
import { searchKnowledge, createKnowledgeItem, listKnowledge, promoteCandidate } from '@gijun-ai/core'

export const knowledgeRouter: ReturnType<typeof Router> = Router()

const SearchBody = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5),
  project: z.string().optional(),
})

const listHandler: RequestHandler = (req, res, next) => {
  try {
    const layer = req.query['layer'] as string | undefined
    res.json(listKnowledge(layer))
  } catch (err) { next(err) }
}

const createHandler: RequestHandler = (req, res, next) => {
  try {
    const id = createKnowledgeItem(req.body)
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

const searchHandler: RequestHandler = (req, res, next) => {
  try {
    const { query, limit, project } = SearchBody.parse(req.body)
    const opts: { limit: number; project?: string } = { limit }
    if (project !== undefined) opts.project = project
    res.json(searchKnowledge(query, opts))
  } catch (err) { next(err) }
}

const promoteHandler: RequestHandler = (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string, 10)
    if (isNaN(id)) { res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid id' } }); return }
    promoteCandidate(id)
    res.json({ ok: true })
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string }
    if (e.code === 'ALREADY_PROMOTED') { res.status(409).json({ error: { code: 'ALREADY_PROMOTED', message: e.message } }); return }
    if (e.message?.includes('not found')) { res.status(404).json({ error: { code: 'NOT_FOUND', message: e.message } }); return }
    next(err)
  }
}

// Static /search must be registered before dynamic /:id
knowledgeRouter.get('/', requireToken, listHandler)
knowledgeRouter.post('/', requireToken, createHandler)
knowledgeRouter.post('/search', requireToken, searchHandler)
knowledgeRouter.post('/:id/promote', requireToken, promoteHandler)
