import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { z } from 'zod'
import { searchKnowledge, createKnowledgeItem, listKnowledge, promoteCandidate, LIST_MAX_LIMIT } from '@gijun-ai/core'

export const knowledgeRouter: ReturnType<typeof Router> = Router()

const ID_PARAM = z.coerce.number().int().positive()

const ListQuery = z.object({
  layer: z.enum(['global', 'project', 'incident', 'candidate']).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
})

const SearchBody = z.object({
  query: z.string().min(1).max(1024),
  limit: z.number().int().min(1).max(20).default(5),
  project: z.string().max(128).optional(),
})

const CreateBody = z.object({
  layer: z.enum(['global', 'project', 'incident', 'candidate']),
  title: z.string().min(1).max(512),
  content: z.string().min(1).max(16384),
  project: z.string().max(128).optional(),
  domain: z.string().max(128).optional(),
  sourceIncidentId: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
})

const listHandler: RequestHandler = (req, res, next) => {
  try {
    const q = ListQuery.parse(req.query)
    const opts: { layer?: string; limit?: number } = {}
    if (q.layer !== undefined) opts.layer = q.layer
    if (q.limit !== undefined) opts.limit = q.limit
    res.json(listKnowledge(opts))
  } catch (err) { next(err) }
}

const createHandler: RequestHandler = (req, res, next) => {
  try {
    const parsed = CreateBody.parse(req.body ?? {})
    const id = createKnowledgeItem(parsed)
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

const searchHandler: RequestHandler = (req, res, next) => {
  try {
    const { query, limit, project } = SearchBody.parse(req.body ?? {})
    const opts: { limit: number; project?: string } = { limit }
    if (project !== undefined) opts.project = project
    res.json(searchKnowledge(query, opts))
  } catch (err) { next(err) }
}

const promoteHandler: RequestHandler = (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    promoteCandidate(id)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

knowledgeRouter.get('/', requireToken, listHandler)
knowledgeRouter.post('/', requireToken, createHandler)
knowledgeRouter.post('/search', requireToken, searchHandler)
knowledgeRouter.post('/:id/promote', requireToken, promoteHandler)
