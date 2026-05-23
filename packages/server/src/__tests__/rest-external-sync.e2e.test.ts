import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')
process.env['AGENTGUARD_TOKEN'] = 'test-token-external-sync'

const { createApp } = await import('../app.js')
const core = await import('@gijun-ai/core')

const TOKEN = 'test-token-external-sync'
let server: Server
let baseUrl: string

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-AgentGuard-Token': TOKEN }
}

type ExternalSyncBody = {
  externalSource: string
  externalId: string
  title: string
  description?: string
  status?: 'pending' | 'in_progress' | 'done' | 'cancelled'
}

async function postExternal(body: ExternalSyncBody): Promise<{ status: number; body: { id: number; created: boolean } }> {
  const res = await fetch(`${baseUrl}/tasks/external`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as { id: number; created: boolean }
  return { status: res.status, body: json }
}

type AuditTailRow = {
  id: number
  event_type: string
  resource_id: string | null
  payload: string
}

async function findAuditEvent(
  eventType: string,
  resourceId: number,
): Promise<AuditTailRow | undefined> {
  const res = await fetch(`${baseUrl}/audit?n=200`, { headers: authHeaders() })
  assert.equal(res.status, 200, 'audit tail must return 200')
  const events = (await res.json()) as AuditTailRow[]
  return events.find(
    (e) => e.event_type === eventType && e.resource_id === String(resourceId),
  )
}

before(async () => {
  core.runMigrations()
  const app = createApp()
  await new Promise<void>((resolvePromise) => {
    server = app.listen(0, '127.0.0.1', () => resolvePromise())
  })
  const addr = server.address()
  if (typeof addr !== 'object' || addr === null) throw new Error('unexpected address')
  baseUrl = `http://127.0.0.1:${addr.port}`
})

after(async () => {
  await new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise())
  })
  core.closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
  delete process.env['AGENTGUARD_TOKEN']
})

test('E2E external-sync: first upsert returns 201 + created=true', async () => {
  const { status, body } = await postExternal({
    externalSource: 'csr-bulletin',
    externalId: 'csr-1001-first',
    title: 'first external task',
  })
  assert.equal(status, 201, 'first upsert must return 201 Created')
  assert.equal(body.created, true, 'first upsert must report created=true')
  assert.ok(body.id > 0, 'first upsert must return a positive task id')
})

test('E2E external-sync: same (externalSource, externalId) returns 200 + created=false (idempotent)', async () => {
  const payload = {
    externalSource: 'csr-bulletin',
    externalId: 'csr-1002-idempotent',
    title: 'idempotent external task',
  }
  const first = await postExternal(payload)
  assert.equal(first.status, 201, 'first call must return 201')
  assert.equal(first.body.created, true, 'first call must report created=true')

  const second = await postExternal(payload)
  assert.equal(second.status, 200, 'second call (same pair) must return 200 OK (idempotent)')
  assert.equal(second.body.created, false, 'second call must report created=false')
  assert.equal(second.body.id, first.body.id, 'idempotent call must reuse the same task id')
})

test('E2E external-sync: same externalId across different externalSource creates distinct rows (partial unique index)', async () => {
  const sharedId = 'shared-external-id-001'
  const a = await postExternal({
    externalSource: 'system-a',
    externalId: sharedId,
    title: 'task in system-a',
  })
  const b = await postExternal({
    externalSource: 'system-b',
    externalId: sharedId,
    title: 'task in system-b',
  })
  assert.equal(a.status, 201, 'system-a first call must return 201')
  assert.equal(b.status, 201, 'system-b first call (different source) must also return 201')
  assert.equal(a.body.created, true)
  assert.equal(b.body.created, true)
  assert.notEqual(a.body.id, b.body.id, 'different externalSource must yield distinct task rows')
})

test('E2E external-sync: insert path emits task.external_sync audit event with externalSource/Id payload', async () => {
  const { status, body } = await postExternal({
    externalSource: 'audit-source',
    externalId: 'audit-id-001',
    title: 'audit-traced external task',
  })
  assert.equal(status, 201)

  const evt = await findAuditEvent('task.external_sync', body.id)
  assert.ok(evt, `expected task.external_sync event for resource ${body.id}`)
  const payload = JSON.parse(evt.payload) as {
    externalSource: string
    externalId: string
    created?: boolean
  }
  assert.equal(payload.externalSource, 'audit-source')
  assert.equal(payload.externalId, 'audit-id-001')
  assert.equal(payload.created, true, 'insert-path audit payload must record created=true')
})
