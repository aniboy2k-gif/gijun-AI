import { z } from 'zod'
import { getDb } from '../db/client.js'
import { appendAuditEvent, insertAuditEventInTx } from '../audit/service.js'
import { CodedError, ErrorCode } from '../lib/error-codes.js'
import { LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT } from '../lib/limits.js'

export const KnowledgeItemSchema = z.object({
  layer: z.enum(['global', 'project', 'incident', 'candidate']),
  // Note: 'candidate' layer is legacy (pre-007). New items use status='draft' with a resolved layer.
  title: z.string().min(1),
  content: z.string().min(1),
  project: z.string().optional(),
  domain: z.string().optional(),
  sourceIncidentId: z.number().int().optional(),
  tags: z.array(z.string()).default([]),
})

export type KnowledgeItemInput = z.input<typeof KnowledgeItemSchema>

type KnowledgeRow = {
  id: number
  layer: string
  title: string
  content: string
  project: string | null
  domain: string | null
  relevance_score: number
  applied_count: number
  tags: string
  created_at: string
  status: string | null
  status_reason: string | null
  supersedes_id: number | null
}

// biome-ignore lint/correctness/noUnusedVariables: reserved for future priority-based sorting
const LAYER_PRIORITY: Record<string, number> = {
  incident: 3,
  project: 2,
  global: 1,
  candidate: 0,
}

export function searchKnowledge(query: string, opts: { project?: string; limit?: number } = {}): KnowledgeRow[] {
  const db = getDb()
  const limit = opts.limit ?? 3

  const rows = db.prepare(`
    SELECT k.*,
           CASE k.layer
             WHEN 'incident' THEN 3
             WHEN 'project'  THEN 2
             ELSE 1
           END AS priority
    FROM knowledge_items k
    JOIN knowledge_fts f ON k.id = f.rowid
    WHERE knowledge_fts MATCH ?
      AND (k.status IS NULL OR k.status = 'approved')
      AND k.layer != 'candidate'
      ${opts.project ? "AND (k.project = ? OR k.project IS NULL)" : ''}
    ORDER BY priority DESC, rank
    LIMIT ?
  `).all(
    ...(opts.project ? [query, opts.project, limit] : [query, limit])
  ) as KnowledgeRow[]

  return rows
}

export function createKnowledgeItem(input: KnowledgeItemInput): number {
  const validated = KnowledgeItemSchema.parse(input)
  const db = getDb()

  const result = db.prepare(`
    INSERT INTO knowledge_items (layer, title, content, project, domain, source_incident_id, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    validated.layer,
    validated.title,
    validated.content,
    validated.project ?? null,
    validated.domain ?? null,
    validated.sourceIncidentId ?? null,
    JSON.stringify(validated.tags),
  )

  const id = result.lastInsertRowid as number
  appendAuditEvent({ eventType: 'knowledge.create', action: `created knowledge item: ${validated.title}`, resourceType: 'knowledge', resourceId: String(id) })
  return id
}

/**
 * @deprecated Use approveKnowledgeCandidate() for new workflow.
 * Legacy path: promotes layer='candidate' rows to layer='incident' + status='approved'.
 */
export function promoteCandidate(id: number): void {
  const db = getDb()
  const item = db.prepare('SELECT * FROM knowledge_items WHERE id = ? AND layer = ?').get(id, 'candidate') as KnowledgeRow | undefined
  if (!item) throw new CodedError(ErrorCode.NOT_FOUND, `Candidate knowledge item ${id} not found`)

  const already = db.prepare("SELECT id FROM knowledge_items WHERE id = ? AND layer = 'incident'").get(id)
  if (already) throw new CodedError(ErrorCode.CONFLICT, 'Already promoted')

  const createdAt = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      "UPDATE knowledge_items SET layer = 'incident', status = 'approved', updated_at = datetime('now') WHERE id = ?"
    ).run(id)
    insertAuditEventInTx(db, {
      eventType: 'knowledge.promoted', actor: 'human',
      action: `promoted candidate ${id} to incident layer`,
      resourceType: 'knowledge', resourceId: String(id),
    }, createdAt)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function listKnowledge(opts: { layer?: string; limit?: number } = {}): KnowledgeRow[] {
  const limit = Math.min(opts.limit ?? LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT)
  if (opts.layer) {
    return getDb().prepare(
      "SELECT * FROM knowledge_items WHERE layer = ? AND (status IS NULL OR status = 'approved') ORDER BY updated_at DESC LIMIT ?",
    ).all(opts.layer, limit) as KnowledgeRow[]
  }
  return getDb().prepare(
    "SELECT * FROM knowledge_items WHERE (status IS NULL OR status = 'approved') ORDER BY layer, updated_at DESC LIMIT ?",
  ).all(limit) as KnowledgeRow[]
}

/** List knowledge items in draft or candidate status (pending HITL review). */
export function listKnowledgeDrafts(opts: { layer?: string; limit?: number } = {}): KnowledgeRow[] {
  const limit = Math.min(opts.limit ?? LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT)
  if (opts.layer) {
    return getDb().prepare(
      "SELECT * FROM knowledge_items WHERE layer = ? AND status IN ('draft','candidate') ORDER BY updated_at DESC LIMIT ?",
    ).all(opts.layer, limit) as KnowledgeRow[]
  }
  return getDb().prepare(
    "SELECT * FROM knowledge_items WHERE status IN ('draft','candidate') ORDER BY layer, updated_at DESC LIMIT ?",
  ).all(limit) as KnowledgeRow[]
}

// ---------------------------------------------------------------------------
// Status lifecycle helpers (migration 007+)
// ---------------------------------------------------------------------------

export type DaCandidateInput = {
  title: string
  content: string
  /** Reason this item deserves knowledge status (bias-prevention field). */
  reasoning: string
  targetLayer: 'global' | 'project' | 'incident'
  project?: string
  domain?: string
  tags?: string[]
  /** DA session identifier, e.g. '/tmp/da-chain-XXXX', stored in status_reason. */
  sourceSessionId?: string
}

/** Create a draft knowledge item pre-filled from DA output. status='draft'. */
export function createDaCandidate(input: DaCandidateInput): number {
  const db = getDb()
  const tags = JSON.stringify(input.tags ?? [])
  const reason = [
    input.reasoning,
    input.sourceSessionId ? `source:${input.sourceSessionId}` : null,
  ].filter(Boolean).join(' | ')

  const result = db.prepare(`
    INSERT INTO knowledge_items
      (layer, title, content, project, domain, tags, status, status_reason)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)
  `).run(
    input.targetLayer,
    input.title,
    input.content,
    input.project ?? null,
    input.domain ?? null,
    tags,
    reason,
  )
  const id = result.lastInsertRowid as number
  appendAuditEvent({
    eventType: 'knowledge.da_candidate_created',
    actor: 'human',
    action: `created DA draft '${input.title}' in ${input.targetLayer} layer`,
    resourceType: 'knowledge',
    resourceId: String(id),
    payload: { title: input.title, targetLayer: input.targetLayer, sourceSessionId: input.sourceSessionId ?? null },
  })
  return id
}

/** Transition status from `fromStatus` to `toStatus` with compare-and-swap. */
function transitionStatus(
  id: number,
  fromStatus: string,
  toStatus: string,
  eventName: string,
  eventAction: string,
  reason?: string,
): void {
  const db = getDb()
  const now = new Date().toISOString()

  const row = db.prepare('SELECT * FROM knowledge_items WHERE id = ?').get(id) as KnowledgeRow | undefined
  if (!row) throw new CodedError(ErrorCode.NOT_FOUND, `Knowledge item ${id} not found`)

  db.exec('BEGIN IMMEDIATE')
  try {
    const isActive = toStatus === 'rejected' ? 0 : 1
    const affected = db.prepare(
      "UPDATE knowledge_items SET status = ?, status_reason = ?, is_active = ?, updated_at = datetime('now') WHERE id = ? AND status = ?"
    ).run(toStatus, reason ?? null, isActive, id, fromStatus)

    if ((affected.changes as number) !== 1) {
      db.exec('ROLLBACK')
      throw new CodedError(
        ErrorCode.INVALID_STATE,
        `Knowledge item ${id} has status '${row.status ?? 'null'}', expected '${fromStatus}'`
      )
    }

    insertAuditEventInTx(db, {
      eventType: `knowledge.${eventName}`,
      actor: 'human',
      action: eventAction,
      resourceType: 'knowledge',
      resourceId: String(id),
      payload: {
        from_status: fromStatus,
        to_status: toStatus,
        reason: reason ?? null,
        knowledge_item_snapshot: { id: row.id, title: row.title, layer: row.layer, status: row.status },
      },
    }, now)

    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** draft → candidate (user nominates for review). */
export function nominateKnowledgeCandidate(id: number): void {
  transitionStatus(id, 'draft', 'candidate', 'candidate_nominated', `nominated item ${id} draft→candidate`)
}

/** candidate → approved (HITL approval). */
export function approveKnowledgeCandidate(id: number, opts?: { reason?: string }): void {
  transitionStatus(id, 'candidate', 'approved', 'candidate_approved',
    `approved item ${id} candidate→approved`, opts?.reason)
}

/** approved → rejected (revoke — DA CRITICAL C1). */
export function revokeKnowledgeApproval(id: number, reason: string): void {
  transitionStatus(id, 'approved', 'rejected', 'approval_revoked',
    `revoked approval for item ${id} approved→rejected`, reason)
}

/** draft|candidate → rejected. */
export function rejectKnowledgeCandidate(id: number, reason: string): void {
  const db = getDb()
  const row = db.prepare('SELECT status FROM knowledge_items WHERE id = ?').get(id) as { status: string | null } | undefined
  if (!row) throw new CodedError(ErrorCode.NOT_FOUND, `Knowledge item ${id} not found`)

  const currentStatus = row.status ?? 'approved'
  if (currentStatus !== 'draft' && currentStatus !== 'candidate') {
    throw new CodedError(ErrorCode.INVALID_STATE,
      `Cannot reject item ${id} with status '${currentStatus}' (expected draft or candidate)`)
  }
  transitionStatus(id, currentStatus, 'rejected', 'candidate_rejected',
    `rejected item ${id} ${currentStatus}→rejected`, reason)
}

/**
 * Restore a rejected item by creating a NEW row (Option A).
 * The rejected row stays immutable. The new row has status='draft'
 * and supersedes_id pointing to the rejected original.
 */
export function restoreFromRejected(id: number, opts?: { reason?: string }): number {
  const db = getDb()

  const original = db.prepare('SELECT * FROM knowledge_items WHERE id = ? AND status = ?')
    .get(id, 'rejected') as KnowledgeRow | undefined
  if (!original) {
    throw new CodedError(ErrorCode.NOT_FOUND, `Rejected knowledge item ${id} not found`)
  }

  const result = db.prepare(`
    INSERT INTO knowledge_items
      (layer, title, content, project, domain, tags, status, status_reason, supersedes_id)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(
    original.layer,
    original.title,
    original.content,
    original.project,
    original.domain,
    original.tags,
    opts?.reason ?? null,
    id,
  )
  const newId = result.lastInsertRowid as number

  appendAuditEvent({
    eventType: 'knowledge.restored_from_rejected',
    actor: 'human',
    action: `restored rejected item ${id} as new draft ${newId}`,
    resourceType: 'knowledge',
    resourceId: String(newId),
    payload: {
      original_id: id,
      new_id: newId,
      reason: opts?.reason ?? null,
      original_snapshot: { id: original.id, title: original.title, layer: original.layer },
    },
  })
  return newId
}
