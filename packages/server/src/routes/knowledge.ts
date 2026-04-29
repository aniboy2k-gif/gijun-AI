import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { z } from 'zod'
import {
  searchKnowledge, createKnowledgeItem, listKnowledge, listKnowledgeDrafts,
  promoteCandidate, createDaCandidate, nominateKnowledgeCandidate,
  approveKnowledgeCandidate, revokeKnowledgeApproval, rejectKnowledgeCandidate,
  restoreFromRejected, LIST_MAX_LIMIT,
} from '@gijun-ai/core'

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

const DaCandidateBody = z.object({
  title: z.string().min(1).max(512),
  content: z.string().min(1).max(16384),
  reasoning: z.string().min(1).max(2048),
  targetLayer: z.enum(['global', 'project', 'incident']),
  project: z.string().max(128).optional(),
  domain: z.string().max(128).optional(),
  tags: z.array(z.string()).optional(),
  sourceSessionId: z.string().optional(),
})

const RejectBody = z.object({ reason: z.string().min(1).max(1024) })
const ApproveBody = z.object({ reason: z.string().optional() })
const RestoreBody = z.object({ reason: z.string().optional() })

const draftsHandler: RequestHandler = (req, res, next) => {
  try {
    const q = ListQuery.parse(req.query)
    const opts: { layer?: string; limit?: number } = {}
    if (q.layer !== undefined) opts.layer = q.layer
    if (q.limit !== undefined) opts.limit = q.limit
    res.json(listKnowledgeDrafts(opts))
  } catch (err) { next(err) }
}

const daCandidateHandler: RequestHandler = (req, res, next) => {
  try {
    const body = DaCandidateBody.parse(req.body ?? {})
    const input: import('@gijun-ai/core').DaCandidateInput = {
      title: body.title,
      content: body.content,
      reasoning: body.reasoning,
      targetLayer: body.targetLayer,
    }
    if (body.project !== undefined) input.project = body.project
    if (body.domain !== undefined) input.domain = body.domain
    if (body.tags !== undefined) input.tags = body.tags
    if (body.sourceSessionId !== undefined) input.sourceSessionId = body.sourceSessionId
    const id = createDaCandidate(input)
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

const nominateHandler: RequestHandler = (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    nominateKnowledgeCandidate(id)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

const approveHandler: RequestHandler = (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    const body = ApproveBody.parse(req.body ?? {})
    const opts: { reason?: string } = {}
    if (body.reason !== undefined) opts.reason = body.reason
    approveKnowledgeCandidate(id, opts)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

const revokeHandler: RequestHandler = (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    const { reason } = RejectBody.parse(req.body ?? {})
    revokeKnowledgeApproval(id, reason)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

const rejectHandler: RequestHandler = (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    const { reason } = RejectBody.parse(req.body ?? {})
    rejectKnowledgeCandidate(id, reason)
    res.json({ ok: true })
  } catch (err) { next(err) }
}

const restoreHandler: RequestHandler = (req, res, next) => {
  try {
    const id = ID_PARAM.parse(req.params['id'])
    const body = RestoreBody.parse(req.body ?? {})
    const opts: { reason?: string } = {}
    if (body.reason !== undefined) opts.reason = body.reason
    const newId = restoreFromRejected(id, opts)
    res.status(201).json({ id: newId })
  } catch (err) { next(err) }
}

knowledgeRouter.get('/', requireToken, listHandler)
knowledgeRouter.get('/drafts', requireToken, draftsHandler)
knowledgeRouter.post('/', requireToken, createHandler)
knowledgeRouter.post('/search', requireToken, searchHandler)
knowledgeRouter.post('/da-candidate', requireToken, daCandidateHandler)
knowledgeRouter.post('/:id/promote', requireToken, promoteHandler)
knowledgeRouter.post('/:id/nominate', requireToken, nominateHandler)
knowledgeRouter.post('/:id/approve', requireToken, approveHandler)
knowledgeRouter.post('/:id/revoke', requireToken, revokeHandler)
knowledgeRouter.post('/:id/reject', requireToken, rejectHandler)
knowledgeRouter.post('/:id/restore', requireToken, restoreHandler)
