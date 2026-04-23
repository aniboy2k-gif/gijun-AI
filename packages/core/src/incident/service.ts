import { z } from 'zod'
import { createHash } from 'node:crypto'
import { getDb } from '../db/client.js'
import { appendAuditEvent, insertAuditEventInTx } from '../audit/service.js'
import { CodedError, ErrorCode } from '../lib/error-codes.js'
import { LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT } from '../lib/limits.js'

export const IncidentSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  aiService: z.string().optional(),
  taskId: z.number().int().optional(),
  playbookId: z.number().int().optional(),
  description: z.string().min(1),
  rootCause: z.string().optional(),
  resolution: z.string().optional(),
  preventionRule: z.string().optional(),
})

export type IncidentInput = z.input<typeof IncidentSchema>

const PROMOTION_THRESHOLD = 5

function computePatternHash(description: string): string {
  const normalized = description.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

export function reportIncident(input: IncidentInput): number {
  const validated = IncidentSchema.parse(input)
  const db = getDb()
  const patternHash = computePatternHash(validated.description)

  const result = db.prepare(`
    INSERT INTO incidents (title, severity, ai_service, task_id, playbook_id, description, root_cause, resolution, prevention_rule, pattern_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    validated.title,
    validated.severity,
    validated.aiService ?? null,
    validated.taskId ?? null,
    validated.playbookId ?? null,
    validated.description,
    validated.rootCause ?? null,
    validated.resolution ?? null,
    validated.preventionRule ?? null,
    patternHash,
  )

  const id = result.lastInsertRowid as number
  updatePatternCount(patternHash, validated.description)
  appendAuditEvent({ eventType: 'incident.report', action: `incident reported: ${validated.title}`, resourceType: 'incident', resourceId: String(id), taskId: validated.taskId })
  return id
}

function updatePatternCount(patternHash: string, summary: string): void {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM incident_patterns WHERE pattern_hash = ?').get(patternHash) as { occurrence_count: number; promotion_status: string } | undefined

  if (!existing) {
    db.prepare(`
      INSERT INTO incident_patterns (pattern_hash, pattern_summary) VALUES (?, ?)
    `).run(patternHash, summary.slice(0, 200))
    return
  }

  const newCount = existing.occurrence_count + 1
  db.prepare(`
    UPDATE incident_patterns
    SET occurrence_count = ?, last_seen_at = datetime('now'),
        promotion_status = CASE WHEN ? >= ? AND promotion_status = 'watching' THEN 'candidate' ELSE promotion_status END
    WHERE pattern_hash = ?
  `).run(newCount, newCount, PROMOTION_THRESHOLD, patternHash)
}

export function listCandidatePatterns(opts: { limit?: number } = {}): unknown[] {
  const limit = Math.min(opts.limit ?? LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT)
  return getDb().prepare(`
    SELECT * FROM incident_patterns WHERE promotion_status = 'candidate' ORDER BY occurrence_count DESC LIMIT ?
  `).all(limit)
}

export function approvePatternPromotion(patternHash: string): void {
  const db = getDb()
  const pattern = db.prepare("SELECT promotion_status FROM incident_patterns WHERE pattern_hash = ?").get(patternHash) as { promotion_status: string } | undefined
  if (!pattern) throw new CodedError(ErrorCode.NOT_FOUND, `Pattern not found: ${patternHash}`)
  if (pattern.promotion_status === 'promoted') throw new CodedError(ErrorCode.CONFLICT, 'Pattern already promoted')

  const createdAt = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      UPDATE incident_patterns
      SET promotion_status = 'promoted', human_approved = 1, promoted_at = datetime('now')
      WHERE pattern_hash = ?
    `).run(patternHash)
    insertAuditEventInTx(db, {
      eventType: 'incident.pattern_promoted', actor: 'human',
      action: `pattern promoted: ${patternHash}`,
      resourceType: 'incident_pattern', resourceId: patternHash,
    }, createdAt)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function listIncidents(opts: { status?: string; severity?: string; limit?: number } = {}): unknown[] {
  const conditions: string[] = []
  const values: (string | number | null)[] = []

  if (opts.status) { conditions.push('status = ?'); values.push(opts.status) }
  if (opts.severity) { conditions.push('severity = ?'); values.push(opts.severity) }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  values.push(Math.min(opts.limit ?? LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT))

  return getDb().prepare(`SELECT * FROM incidents ${where} ORDER BY created_at DESC LIMIT ?`).all(...values)
}
