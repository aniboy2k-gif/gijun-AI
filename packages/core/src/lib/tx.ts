import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '../db/client.js'
import { insertAuditEventInTx, type AuditEventInput } from '../audit/service.js'

/**
 * Atomic wrapper for a state change plus its audit event.
 *
 * Semantics:
 * - Opens BEGIN IMMEDIATE before `fn` runs.
 * - Calls `fn(db)` to perform the state change and return `{ result, audit }`.
 * - Writes the audit row inside the same transaction via `insertAuditEventInTx`.
 * - COMMIT on success, ROLLBACK + rethrow on any error (including audit failure).
 *
 * Audit-first policy: if the audit insert fails, the state change is rolled back
 * (no silent audit loss). Callers relying on partial state must not be added to
 * this wrapper.
 *
 * node:sqlite is synchronous — this function is synchronous by design; do not
 * await inside `fn` or wrap the return type in a Promise.
 */
export function withTxAndAudit<T>(
  fn: (db: DatabaseSync) => { result: T; audit: AuditEventInput },
): T {
  const db = getDb()
  const createdAt = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    const { result, audit } = fn(db)
    insertAuditEventInTx(db, audit, createdAt)
    db.exec('COMMIT')
    return result
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* rollback of an already-aborted tx is fine */ }
    throw e
  }
}
