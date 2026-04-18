import { z } from 'zod'
import { getDb } from '../db/client.js'
import { computeContentHash, computeChainHash, getGenesisHash } from './chain.js'

export const AuditEventSchema = z.object({
  eventType: z.string().min(1),
  actor: z.enum(['ai', 'human', 'system']).default('ai'),
  actorModel: z.string().optional(),
  taskId: z.number().int().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  action: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  ipAddr: z.string().optional(),
})

export type AuditEventInput = z.input<typeof AuditEventSchema>

export function appendAuditEvent(input: AuditEventInput): number {
  const validated = AuditEventSchema.parse(input)
  const db = getDb()
  const createdAt = new Date().toISOString()

  const lastRow = db
    .prepare('SELECT chain_hash FROM audit_events ORDER BY id DESC LIMIT 1')
    .get() as { chain_hash: string } | undefined

  const prevHash = lastRow?.chain_hash ?? getGenesisHash()

  const contentHash = computeContentHash({
    eventType: validated.eventType,
    actor: validated.actor,
    action: validated.action,
    payload: validated.payload,
    createdAt,
  })

  const chainHash = computeChainHash(prevHash, contentHash)

  const result = db.prepare(`
    INSERT INTO audit_events
      (prev_hash, content_hash, chain_hash, event_type, actor, actor_model,
       task_id, resource_type, resource_id, action, payload, ip_addr, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    prevHash,
    contentHash,
    chainHash,
    validated.eventType,
    validated.actor,
    validated.actorModel ?? null,
    validated.taskId ?? null,
    validated.resourceType ?? null,
    validated.resourceId ?? null,
    validated.action,
    JSON.stringify(validated.payload),
    validated.ipAddr ?? null,
    createdAt,
  )

  return result.lastInsertRowid as number
}

export function tailAuditEvents(n = 20): unknown[] {
  return getDb()
    .prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT ?')
    .all(n)
}
