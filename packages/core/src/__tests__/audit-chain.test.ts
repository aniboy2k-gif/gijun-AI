import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

// In-memory DB for test isolation
process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')

import { appendAuditEvent, tailAuditEvents } from '../audit/service.js'
import { runMigrations, closeDb } from '../db/client.js'

type AuditRow = {
  id: number
  prev_hash: string
  content_hash: string
  chain_hash: string
}

before(() => {
  runMigrations()
})

after(() => {
  closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
})

test('audit chain: second event prev_hash equals first event chain_hash', () => {
  const id1 = appendAuditEvent({ eventType: 'test.first', action: 'first action' })
  const id2 = appendAuditEvent({ eventType: 'test.second', action: 'second action' })

  const rows = tailAuditEvents(10) as AuditRow[]
  const row1 = rows.find(r => r.id === id1)
  const row2 = rows.find(r => r.id === id2)

  assert.ok(row1, 'first event row must exist')
  assert.ok(row2, 'second event row must exist')
  assert.equal(row2.prev_hash, row1.chain_hash,
    'second event prev_hash must equal first event chain_hash')
})

test('audit chain: each event chain_hash = sha256(prev_hash + content_hash)', () => {
  const id = appendAuditEvent({ eventType: 'test.verify', action: 'verify hash' })
  const rows = tailAuditEvents(10) as AuditRow[]
  const row = rows.find(r => r.id === id)

  assert.ok(row, 'event row must exist')
  const expected = createHash('sha256')
    .update(row.prev_hash + row.content_hash)
    .digest('hex')
  assert.equal(row.chain_hash, expected,
    'chain_hash must be sha256(prev_hash + content_hash)')
})
