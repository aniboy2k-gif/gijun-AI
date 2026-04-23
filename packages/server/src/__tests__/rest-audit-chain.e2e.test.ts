import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')
process.env['AGENTGUARD_TOKEN'] = 'test-token-audit'

const { createApp } = await import('../app.js')
const core = await import('@gijun-ai/core')

const TOKEN = 'test-token-audit'
let server: Server
let baseUrl: string

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-AgentGuard-Token': TOKEN }
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

test('E2E audit: append 3 events, integrity-check returns valid=true', async () => {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${baseUrl}/audit`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        eventType: 'e2e.test',
        actor: 'system',
        action: `action-${i}`,
        payload: { step: i, note: 'e2e audit chain test' },
      }),
    })
    assert.equal(res.status, 201, `event ${i} should append successfully (201 Created)`)
  }

  const checkRes = await fetch(`${baseUrl}/audit/integrity-check`, {
    method: 'GET',
    headers: authHeaders(),
  })
  assert.equal(checkRes.status, 200)
  const body = (await checkRes.json()) as { valid: boolean; total: number; broken: unknown[] }
  assert.equal(body.valid, true, 'chain should be intact after 3 appends')
  assert.ok(body.total >= 3, `total should be at least 3 (got ${body.total})`)
  assert.deepEqual(body.broken, [], 'no broken links expected')
})

test('E2E audit: tail returns most-recent events in reverse order', async () => {
  const res = await fetch(`${baseUrl}/audit?n=5`, {
    method: 'GET',
    headers: authHeaders(),
  })
  assert.equal(res.status, 200)
  const events = (await res.json()) as Array<{ id: number; event_type: string }>
  assert.ok(Array.isArray(events), 'tail should return an array')
  assert.ok(events.length > 0, 'should have at least one event')
  // Most recent first: id should be monotonically decreasing
  for (let i = 1; i < events.length; i++) {
    assert.ok(
      (events[i - 1]?.id ?? 0) > (events[i]?.id ?? 0),
      'events should be in descending id order',
    )
  }
})
