import { z } from 'zod'
import { getDb } from '../db/client.js'
import { computeContentHash, computeChainHash, getGenesisHash } from './chain.js'

// Patterns that match common API key / token formats.
// Applied to string values inside payload before storage.
const REDACT_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
  /ghp_[A-Za-z0-9]{36}/g,          // GitHub personal access tokens
]
const REDACTED_PLACEHOLDER = '[REDACTED]'

function redactString(s: string): string {
  let result = s
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, REDACTED_PLACEHOLDER)
  }
  return result
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v)
    }
    return out
  }
  return value
}

export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redactValue(payload) as Record<string, unknown>
}

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

type ValidatedAuditEvent = z.infer<typeof AuditEventSchema>

/**
 * Internal helper. Reads prevHash, computes original/content/chain hashes
 * (against unredacted vs redacted payload), and INSERTs the audit row.
 * Must run inside an open transaction owned by the caller — does NOT
 * BEGIN/COMMIT itself.
 */
function insertAuditRow(
  db: ReturnType<typeof getDb>,
  validated: ValidatedAuditEvent,
  createdAt: string,
): number {
  const lastRow = db
    .prepare('SELECT chain_hash FROM audit_events ORDER BY id DESC LIMIT 1')
    .get() as { chain_hash: string } | undefined
  const prevHash = lastRow?.chain_hash ?? getGenesisHash()

  // originalHash: hash of the *unredacted* payload — chain_hash binds to
  // this so redaction policy changes don't invalidate the chain.
  const originalHash = computeContentHash({
    eventType: validated.eventType,
    actor: validated.actor,
    action: validated.action,
    payload: validated.payload,
    createdAt,
  })

  // Redact sensitive data before storage; contentHash is the hash of the
  // post-redaction payload (what's actually persisted).
  const redactedPayload = redactPayload(validated.payload)
  const contentHash = computeContentHash({
    eventType: validated.eventType,
    actor: validated.actor,
    action: validated.action,
    payload: redactedPayload,
    createdAt,
  })

  const chainHash = computeChainHash(prevHash, originalHash)

  const result = db.prepare(`
    INSERT INTO audit_events
      (prev_hash, original_hash, original_hash_type, content_hash, chain_hash,
       event_type, actor, actor_model,
       task_id, resource_type, resource_id, action, payload, ip_addr, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    prevHash, originalHash, 'redaction_pre', contentHash, chainHash,
    validated.eventType, validated.actor, validated.actorModel ?? null,
    validated.taskId ?? null, validated.resourceType ?? null, validated.resourceId ?? null,
    validated.action, JSON.stringify(redactedPayload), validated.ipAddr ?? null, createdAt,
  )
  return result.lastInsertRowid as number
}

/**
 * Internal: INSERT only — no own transaction. Must be called inside an active
 * BEGIN IMMEDIATE transaction so it shares the caller's write lock and commit.
 */
export function insertAuditEventInTx(
  db: ReturnType<typeof getDb>,
  input: AuditEventInput,
  createdAt: string,
): number {
  return insertAuditRow(db, AuditEventSchema.parse(input), createdAt)
}

export function appendAuditEvent(input: AuditEventInput): number {
  const validated = AuditEventSchema.parse(input)
  const db = getDb()
  const createdAt = new Date().toISOString()

  // BEGIN IMMEDIATE acquires a write lock upfront, preventing hash-chain fork
  // when multiple processes read the same prevHash before either inserts.
  db.exec('BEGIN IMMEDIATE')
  try {
    const id = insertAuditRow(db, validated, createdAt)
    db.exec('COMMIT')
    return id
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function tailAuditEvents(n = 20): unknown[] {
  return getDb()
    .prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT ?')
    .all(n)
}
