import { z } from 'zod'
import { getDb } from '../db/client.js'
import { appendAuditEvent } from '../audit/service.js'
import { CodedError, ErrorCode } from '../lib/error-codes.js'
import { LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT } from '../lib/limits.js'

export const PlaybookSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  scope: z.enum(['global', 'project']).default('global'),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
})

export type PlaybookInput = z.input<typeof PlaybookSchema>

type PlaybookRow = {
  id: number
  slug: string
  title: string
  scope: string
  version: number
  content: string
  tags: string
  is_active: number
  effectiveness_score: number
  last_applied_at: string | null
  created_at: string
  updated_at: string
}

export function createPlaybook(input: PlaybookInput): number {
  const validated = PlaybookSchema.parse(input)
  const db = getDb()

  const result = db.prepare(`
    INSERT INTO playbooks (slug, title, scope, content, tags)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    validated.slug,
    validated.title,
    validated.scope,
    validated.content,
    JSON.stringify(validated.tags),
  )

  const id = result.lastInsertRowid as number
  appendAuditEvent({ eventType: 'playbook.create', action: `created playbook ${validated.slug}`, resourceType: 'playbook', resourceId: String(id) })
  return id
}

export function updatePlaybook(id: number, input: Partial<PlaybookInput>, changeNote?: string): void {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM playbooks WHERE id = ?').get(id) as PlaybookRow | undefined
  if (!existing) throw new CodedError(ErrorCode.NOT_FOUND, `Playbook ${id} not found`)

  db.prepare(`
    INSERT INTO playbook_versions (playbook_id, version, content, change_note)
    VALUES (?, ?, ?, ?)
  `).run(id, existing.version, existing.content, changeNote ?? null)

  const partial = PlaybookSchema.partial().parse(input)
  const updates: string[] = []
  const values: (string | number | null)[] = []

  if (partial.title !== undefined) { updates.push('title = ?'); values.push(partial.title) }
  if (partial.content !== undefined) { updates.push('content = ?'); values.push(partial.content) }
  if (partial.scope !== undefined) { updates.push('scope = ?'); values.push(partial.scope) }
  if (partial.tags !== undefined) { updates.push('tags = ?'); values.push(JSON.stringify(partial.tags)) }

  if (updates.length === 0) return

  updates.push('version = version + 1')
  updates.push("updated_at = datetime('now')")
  values.push(id)

  db.prepare(`UPDATE playbooks SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  appendAuditEvent({ eventType: 'playbook.update', action: `updated playbook id=${id}`, resourceType: 'playbook', resourceId: String(id) })
}

export function listPlaybooks(opts: { scope?: string; limit?: number } = {}): PlaybookRow[] {
  const db = getDb()
  const limit = Math.min(opts.limit ?? LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT)
  if (opts.scope) {
    return db.prepare(
      'SELECT * FROM playbooks WHERE scope = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT ?',
    ).all(opts.scope, limit) as PlaybookRow[]
  }
  return db.prepare(
    'SELECT * FROM playbooks WHERE is_active = 1 ORDER BY updated_at DESC LIMIT ?',
  ).all(limit) as PlaybookRow[]
}

export function getPlaybook(slugOrId: string | number): PlaybookRow | undefined {
  const db = getDb()
  if (typeof slugOrId === 'number') {
    return db.prepare('SELECT * FROM playbooks WHERE id = ?').get(slugOrId) as PlaybookRow | undefined
  }
  return db.prepare('SELECT * FROM playbooks WHERE slug = ?').get(slugOrId) as PlaybookRow | undefined
}
