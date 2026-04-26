import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

// In-memory DB for test isolation
process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')

import { appendAuditEvent, tailAuditEvents } from '../audit/service.js'
import { verifyChain } from '../audit/verify-chain.js'
import { runMigrations, closeDb, getDb } from '../db/client.js'

type AuditRow = {
  id: number
  prev_hash: string
  original_hash: string
  content_hash: string
  chain_hash: string
  payload: string
}

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
// Scenario 1: zod validation failure (missing required field) — no row inserted
// ---------------------------------------------------------------------------
test('write-matrix #1: missing required eventType throws and inserts no row', () => {
  freshDb()
  assert.throws(
    // @ts-expect-error intentionally missing required fields
    () => appendAuditEvent({ action: 'something' }),
    Error,
  )
  const rows = tailAuditEvents(10) as AuditRow[]
  assert.equal(rows.length, 0, 'no row must be inserted on zod failure')
})

// ---------------------------------------------------------------------------
// Scenario 2: valid input — single row, chain integrity holds
// ---------------------------------------------------------------------------
test('write-matrix #2: valid append inserts a row with intact chain', () => {
  freshDb()
  const id = appendAuditEvent({ eventType: 'test.valid', action: 'do' })
  const rows = tailAuditEvents(10) as AuditRow[]
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.id, id)
  assert.equal(rows[0]?.prev_hash, '0'.repeat(64), 'first row prev_hash must be GENESIS')
  const result = verifyChain()
  assert.equal(result.valid, true, 'chain must be valid')
  assert.equal(result.total, 1)
})

// ---------------------------------------------------------------------------
// Scenario 3: empty payload (default {}) — accepted, persisted
// ---------------------------------------------------------------------------
test('write-matrix #3: omitted payload defaults to {} and persists', () => {
  freshDb()
  appendAuditEvent({ eventType: 'test.empty', action: 'no-payload' })
  const rows = tailAuditEvents(10) as AuditRow[]
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.payload, '{}', 'default empty payload must persist as "{}"')
  assert.equal(verifyChain().valid, true)
})

// ---------------------------------------------------------------------------
// Scenario 4: large payload (~10KB) — round-trip integrity
// ---------------------------------------------------------------------------
test('write-matrix #4: large payload round-trips and chain stays valid', () => {
  freshDb()
  const large = {
    items: Array.from({ length: 100 }, (_, i) => ({
      idx: i,
      label: `item-${i}`,
      data: 'x'.repeat(50),
      nested: { deep: { value: i * i } },
    })),
  }
  appendAuditEvent({ eventType: 'test.large', action: 'bulk', payload: large })
  const rows = tailAuditEvents(10) as AuditRow[]
  const stored = JSON.parse(rows[0]?.payload ?? '{}') as typeof large
  assert.equal(stored.items.length, 100, 'all items must persist')
  assert.equal(stored.items[42]?.nested.deep.value, 42 * 42)
  assert.equal(verifyChain().valid, true)
})

// ---------------------------------------------------------------------------
// Scenario 5: sequential calls (3 events) — each prev_hash links to prior chain_hash
// ---------------------------------------------------------------------------
test('write-matrix #5: three sequential events form a valid chain', () => {
  freshDb()
  const id1 = appendAuditEvent({ eventType: 'seq.1', action: 'a' })
  const id2 = appendAuditEvent({ eventType: 'seq.2', action: 'b' })
  const id3 = appendAuditEvent({ eventType: 'seq.3', action: 'c' })

  const rows = (
    getDb()
      .prepare('SELECT id, prev_hash, original_hash, content_hash, chain_hash, payload FROM audit_events ORDER BY id ASC')
      .all() as AuditRow[]
  )

  assert.equal(rows.length, 3)
  assert.equal(rows[0]?.id, id1)
  assert.equal(rows[1]?.id, id2)
  assert.equal(rows[2]?.id, id3)

  assert.equal(rows[0]?.prev_hash, '0'.repeat(64))
  assert.equal(rows[1]?.prev_hash, rows[0]?.chain_hash, 'second prev = first chain')
  assert.equal(rows[2]?.prev_hash, rows[1]?.chain_hash, 'third prev = second chain')

  assert.equal(verifyChain().valid, true)
})

// ---------------------------------------------------------------------------
// Scenario 6: payload contains redaction patterns — stored masked,
//             but chain_hash uses originalHash (so chain stays valid)
// ---------------------------------------------------------------------------
test('write-matrix #6: redaction is applied at storage; chain bound to originalHash', () => {
  freshDb()
  const secret = 'sk-proj-' + 'A'.repeat(40)
  appendAuditEvent({
    eventType: 'test.redact',
    action: 'leak',
    payload: { token: secret, plain: 'visible' },
  })
  const rows = tailAuditEvents(10) as AuditRow[]
  const stored = JSON.parse(rows[0]?.payload ?? '{}') as { token: string; plain: string }
  assert.equal(stored.token, '[REDACTED]', 'secret must be masked at rest')
  assert.equal(stored.plain, 'visible', 'non-sensitive data must survive')

  // Chain validity is the binding contract: redaction policy changes must not break the chain.
  assert.equal(verifyChain().valid, true)

  // original_hash != content_hash because pre/post-redaction differ.
  assert.notEqual(
    rows[0]?.original_hash,
    rows[0]?.content_hash,
    'original_hash and content_hash must differ when redaction modified payload',
  )
})

// ---------------------------------------------------------------------------
// Scenario 7: validation failure mid-stream does NOT corrupt the chain
// ---------------------------------------------------------------------------
test('write-matrix #7: a thrown append leaves no orphan; subsequent append still chains correctly', () => {
  freshDb()
  appendAuditEvent({ eventType: 'ok.1', action: 'a' })
  // Invalid actor enum — must throw, must not insert.
  assert.throws(() => appendAuditEvent({
    eventType: 'bad',
    action: 'b',
    // @ts-expect-error intentionally invalid enum
    actor: 'martian',
  }))
  appendAuditEvent({ eventType: 'ok.2', action: 'c' })

  const rows = (
    getDb()
      .prepare('SELECT id, prev_hash, chain_hash FROM audit_events ORDER BY id ASC')
      .all() as Pick<AuditRow, 'id' | 'prev_hash' | 'chain_hash'>[]
  )
  assert.equal(rows.length, 2, 'only the two valid appends must persist')
  assert.equal(rows[1]?.prev_hash, rows[0]?.chain_hash, 'chain link must still be intact')
  assert.equal(verifyChain().valid, true)
})

// ---------------------------------------------------------------------------
// Scenario 8: appending without migrations applied — fail-fast with a clear error
// ---------------------------------------------------------------------------
test('write-matrix #8: append before migrations throws with a recognizable error', () => {
  closeDb()
  // Point migrations at an empty dir to skip schema creation, but keep the connection open.
  const savedPath = process.env['GIJUN_MIGRATIONS_PATH']
  process.env['GIJUN_MIGRATIONS_PATH'] = '/nonexistent/path/for/test'
  runMigrations() // creates schema_migrations only; audit_events does not exist
  try {
    let thrown: Error | undefined
    try {
      appendAuditEvent({ eventType: 'test.no_table', action: 'fail' })
    } catch (e) {
      thrown = e as Error
    }
    assert.ok(thrown, 'appendAuditEvent must throw when audit_events table is missing')
    assert.match(
      String(thrown?.message),
      /audit_events|no such table/i,
      'error message must mention audit_events or "no such table"',
    )
  } finally {
    if (savedPath !== undefined) {
      process.env['GIJUN_MIGRATIONS_PATH'] = savedPath
    } else {
      delete process.env['GIJUN_MIGRATIONS_PATH']
    }
    closeDb()
  }
})
