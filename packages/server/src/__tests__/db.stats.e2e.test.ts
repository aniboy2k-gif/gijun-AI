import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))

process.env['NODE_ENV'] = 'test'
process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')
process.env['AGENTGUARD_TOKEN'] = 'test-token-dbstats'

const { createApp } = await import('../app.js')
const core = await import('@gijun-ai/core')

let server: Server
let baseUrl: string

before(async () => {
  core.runMigrations()
  const app = createApp()
  await new Promise<void>((res) => { server = app.listen(0, '127.0.0.1', () => res()) })
  const addr = server.address()
  if (typeof addr !== 'object' || addr === null) throw new Error('addr')
  baseUrl = `http://127.0.0.1:${addr.port}`
})

after(async () => {
  await new Promise<void>((res) => server.close(() => res()))
  core.closeDb()
  delete process.env['NODE_ENV']
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
  delete process.env['AGENTGUARD_TOKEN']
})

const headers = { 'Content-Type': 'application/json', 'X-AgentGuard-Token': 'test-token-dbstats' }

test('GET /db/stats returns schema with all expected fields', async () => {
  const r = await fetch(`${baseUrl}/db/stats`, { headers })
  assert.equal(r.status, 200)
  const body = await r.json() as Record<string, unknown>
  assert.equal(typeof body.tasks, 'number')
  assert.equal(typeof body.audit_events, 'number')
  assert.equal(typeof body.knowledge_items, 'number')
  assert.equal(typeof body.db_path, 'string')
  // db_size_bytes is null for :memory:
  assert.ok(body.db_size_bytes === null || typeof body.db_size_bytes === 'number')
  assert.equal(body.counts_are_approximate, true)
  assert.match(r.headers.get('cache-control') ?? '', /no-store/)
})

test('GET /db/stats without auth returns 401', async () => {
  const r = await fetch(`${baseUrl}/db/stats`)
  assert.equal(r.status, 401)
})

test('GET /db/stats: counts non-negative', async () => {
  const r = await fetch(`${baseUrl}/db/stats`, { headers })
  const body = await r.json() as { tasks: number; audit_events: number; knowledge_items: number }
  assert.ok(body.tasks >= 0)
  assert.ok(body.audit_events >= 0)
  assert.ok(body.knowledge_items >= 0)
})
