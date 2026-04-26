import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

// In-memory DB for test isolation
process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')

import { appendAuditEvent } from '../audit/service.js'
import { verifyChain } from '../audit/verify-chain.js'
import { runMigrations, closeDb, getDb } from '../db/client.js'

function freshDb(): void {
  closeDb()
  runMigrations()
}

after(() => {
  closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
})

// ---------------------------------------------------------------------------
// Tampering Case 1: prev_hash 변조 — verifyChain detects mismatch
// ---------------------------------------------------------------------------
test('tampering case 1: mutating prev_hash on a middle row breaks the chain', () => {
  freshDb()
  appendAuditEvent({ eventType: 't1', action: 'a' })
  const id2 = appendAuditEvent({ eventType: 't2', action: 'b' })
  appendAuditEvent({ eventType: 't3', action: 'c' })

  // Sanity: chain is valid before tampering.
  assert.equal(verifyChain().valid, true, 'precondition: chain must be valid before tampering')

  // Replace prev_hash on row #2 with a forged value.
  const forged = 'f'.repeat(64)
  getDb().prepare('UPDATE audit_events SET prev_hash = ? WHERE id = ?').run(forged, id2)

  const result = verifyChain()
  assert.equal(result.valid, false, 'verifyChain must detect prev_hash tampering')
  assert.ok(result.broken.length >= 1, 'broken list must contain at least one entry')
  // The tampered row appears in broken (its prev_hash no longer matches the chain expectation).
  assert.ok(
    result.broken.some(b => b.id === id2),
    `broken list must include the tampered row id=${id2}`,
  )
})

// ---------------------------------------------------------------------------
// Tampering Case 2: 행 삭제 (gap) — next row's prev_hash no longer matches
// ---------------------------------------------------------------------------
test('tampering case 2: deleting a middle row creates a gap detected by verifyChain', () => {
  freshDb()
  appendAuditEvent({ eventType: 'g1', action: 'a' })
  const id2 = appendAuditEvent({ eventType: 'g2', action: 'b' })
  appendAuditEvent({ eventType: 'g3', action: 'c' })

  assert.equal(verifyChain().valid, true)

  // Delete row #2: row #3's prev_hash now points at the deleted row's chain_hash,
  // which does not match the new "expected" chain (row #1's chain_hash).
  getDb().prepare('DELETE FROM audit_events WHERE id = ?').run(id2)

  const result = verifyChain()
  assert.equal(result.valid, false, 'verifyChain must detect a deleted middle row')
  assert.equal(result.total, 2, 'total must reflect the surviving rows')
  assert.ok(result.broken.length >= 1, 'broken list must surface the gap')
})

// ---------------------------------------------------------------------------
// Tampering Case 3: chain_hash 변조 — direct mutation of the chain link
// ---------------------------------------------------------------------------
test('tampering case 3: mutating chain_hash on the last row breaks the chain', () => {
  freshDb()
  appendAuditEvent({ eventType: 'c1', action: 'a' })
  const id2 = appendAuditEvent({ eventType: 'c2', action: 'b' })

  assert.equal(verifyChain().valid, true)

  const forged = 'd'.repeat(64)
  getDb().prepare('UPDATE audit_events SET chain_hash = ? WHERE id = ?').run(forged, id2)

  const result = verifyChain()
  assert.equal(result.valid, false, 'verifyChain must detect chain_hash tampering')
  assert.ok(
    result.broken.some(b => b.id === id2),
    `broken list must include the tampered row id=${id2}`,
  )
  // The forged value must appear as the "actual" in the broken entry.
  const entry = result.broken.find(b => b.id === id2)
  assert.equal(entry?.actual, forged, 'broken entry must record the forged value')
})
