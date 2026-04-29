import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')

import { runMigrations, closeDb, getDb } from '../db/client.js'
import {
  upsertExternalTask,
  getTask,
} from '../task/service.js'
import { tailAuditEvents } from '../audit/service.js'

before(() => { runMigrations() })
after(() => {
  closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
})

// ---------------------------------------------------------------------------
// upsertExternalTask: 기본 생성
// ---------------------------------------------------------------------------

test('upsertExternalTask: creates task with external tracking fields', () => {
  const result = upsertExternalTask({
    externalSource: 'bulletin-board-csr',
    externalId: 'csr-101',
    title: '[CSR #101] 새 기능 요청',
  })
  assert.ok(result.id > 0)
  assert.equal(result.created, true)

  const row = getTask(result.id)
  assert.ok(row)
  assert.equal(row.title, '[CSR #101] 새 기능 요청')
  assert.equal(row.status, 'pending')
})

test('upsertExternalTask: stores external_id and external_source', () => {
  const result = upsertExternalTask({
    externalSource: 'bulletin-board-csr',
    externalId: 'csr-102',
    title: '[CSR #102] 테스트',
  })
  const db = getDb()
  const row = db.prepare(
    'SELECT external_id, external_source FROM tasks WHERE id = ?'
  ).get(result.id) as { external_id: string; external_source: string }
  assert.equal(row.external_id, 'csr-102')
  assert.equal(row.external_source, 'bulletin-board-csr')
})

// ---------------------------------------------------------------------------
// upsertExternalTask: 멱등성 (idempotency)
// ---------------------------------------------------------------------------

test('upsertExternalTask: same externalId returns existing task (no duplicate)', () => {
  const first = upsertExternalTask({
    externalSource: 'bulletin-board-csr',
    externalId: 'csr-201',
    title: '원본 제목',
  })
  const second = upsertExternalTask({
    externalSource: 'bulletin-board-csr',
    externalId: 'csr-201',
    title: '원본 제목',
  })
  assert.equal(second.id, first.id)
  assert.equal(second.created, false)

  const db = getDb()
  const count = (db.prepare(
    "SELECT COUNT(*) as cnt FROM tasks WHERE external_id = 'csr-201'"
  ).get() as { cnt: number }).cnt
  assert.equal(count, 1)
})

// ---------------------------------------------------------------------------
// upsertExternalTask: 상태 업데이트
// ---------------------------------------------------------------------------

test('upsertExternalTask: updates status when called with new status', () => {
  const { id } = upsertExternalTask({
    externalSource: 'bulletin-board-csr',
    externalId: 'csr-301',
    title: '[CSR #301] 상태 변경 테스트',
  })
  assert.equal(getTask(id)?.status, 'pending')

  upsertExternalTask({
    externalSource: 'bulletin-board-csr',
    externalId: 'csr-301',
    title: '[CSR #301] 상태 변경 테스트',
    status: 'done',
  })
  assert.equal(getTask(id)?.status, 'done')
})

test('upsertExternalTask: pending→cancelled transition works', () => {
  const { id } = upsertExternalTask({
    externalSource: 'bulletin-board-csr',
    externalId: 'csr-302',
    title: '[CSR #302] 취소 테스트',
  })
  upsertExternalTask({
    externalSource: 'bulletin-board-csr',
    externalId: 'csr-302',
    title: '[CSR #302] 취소 테스트',
    status: 'cancelled',
  })
  assert.equal(getTask(id)?.status, 'cancelled')
})

// ---------------------------------------------------------------------------
// audit event
// ---------------------------------------------------------------------------

test('upsertExternalTask: emits task.external_sync audit event on create', () => {
  const { id } = upsertExternalTask({
    externalSource: 'bulletin-board-csr',
    externalId: 'csr-401',
    title: '[CSR #401] 감사 이벤트 테스트',
  })
  const events = tailAuditEvents(5) as { event_type: string; resource_id: string }[]
  const event = events.find(
    e => e.event_type === 'task.external_sync' && e.resource_id === String(id)
  )
  assert.ok(event, 'task.external_sync audit event must be emitted')
})

// ---------------------------------------------------------------------------
// different externalSource — should create separate tasks
// ---------------------------------------------------------------------------

test('upsertExternalTask: same externalId from different source creates separate tasks', () => {
  const a = upsertExternalTask({
    externalSource: 'source-a',
    externalId: 'shared-id-1',
    title: 'Task from source A',
  })
  const b = upsertExternalTask({
    externalSource: 'source-b',
    externalId: 'shared-id-1',
    title: 'Task from source B',
  })
  assert.notEqual(a.id, b.id)
  assert.equal(a.created, true)
  assert.equal(b.created, true)
})
