import { z } from 'zod'
import { getDb } from '../db/client.js'
import { appendAuditEvent, insertAuditEventInTx } from '../audit/service.js'

export const KnowledgeItemSchema = z.object({
  layer: z.enum(['global', 'project', 'incident', 'candidate']),
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
}

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
      AND k.is_active = 1
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

export function promoteCandidate(id: number): void {
  const db = getDb()
  const item = db.prepare('SELECT * FROM knowledge_items WHERE id = ? AND layer = ?').get(id, 'candidate') as KnowledgeRow | undefined
  if (!item) throw new Error(`Candidate knowledge item ${id} not found`)

  const already = db.prepare("SELECT id FROM knowledge_items WHERE id = ? AND layer = 'incident'").get(id)
  if (already) throw Object.assign(new Error('Already promoted'), { code: 'ALREADY_PROMOTED' })

  // Atomically update state and write audit log in the same transaction.
  const createdAt = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare("UPDATE knowledge_items SET layer = 'incident', updated_at = datetime('now') WHERE id = ?").run(id)
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

export function listKnowledge(layer?: string): KnowledgeRow[] {
  if (layer) {
    return getDb().prepare('SELECT * FROM knowledge_items WHERE layer = ? AND is_active = 1 ORDER BY updated_at DESC').all(layer) as KnowledgeRow[]
  }
  return getDb().prepare('SELECT * FROM knowledge_items WHERE is_active = 1 ORDER BY layer, updated_at DESC').all() as KnowledgeRow[]
}
