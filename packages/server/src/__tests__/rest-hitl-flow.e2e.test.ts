import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')
process.env['AGENTGUARD_TOKEN'] = 'test-token-hitl'
process.env['GIJUN_HITL_STRICT_MODE'] = '1'

const { createApp } = await import('../app.js')
const core = await import('@gijun-ai/core')

const TOKEN = 'test-token-hitl'
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
  delete process.env['GIJUN_HITL_STRICT_MODE']
})

test('E2E HITL flow: critical task PATCH done returns 409 HITL_REQUIRED', async () => {
  // 1. Create a critical task
  const createRes = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      title: 'e2e critical task',
      complexity: 'critical',
      toolName: 'bash',
      actionType: 'execute',
      resource: 'prod-db',
    }),
  })
  assert.equal(createRes.status, 201, 'task creation should succeed (201 Created)')
  const created = (await createRes.json()) as { id: number }
  assert.ok(created.id, 'created task should have an id')

  // 2. Attempt to transition to done without approval
  const patchRes = await fetch(`${baseUrl}/tasks/${created.id}/status`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'done' }),
  })
  assert.equal(
    patchRes.status,
    409,
    'done transition without HITL approval must return 409',
  )
})

test('E2E HITL flow: approve then PATCH done returns 200', async () => {
  const createRes = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      title: 'e2e approval task',
      complexity: 'critical',
      toolName: 'bash',
      actionType: 'execute',
      resource: 'prod-db',
    }),
  })
  const { id } = (await createRes.json()) as { id: number }

  // Approve HITL
  const approveRes = await fetch(`${baseUrl}/tasks/${id}/hitl-approve`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ approver: 'e2e-test' }),
  })
  assert.equal(approveRes.status, 200, 'hitl-approve should succeed')

  // Now transition to done
  const patchRes = await fetch(`${baseUrl}/tasks/${id}/status`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'done' }),
  })
  assert.equal(patchRes.status, 200, 'done transition after approval should succeed')
})

test('E2E HITL flow: trivial task transitions freely', async () => {
  const createRes = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title: 'trivial e2e', complexity: 'trivial' }),
  })
  const { id } = (await createRes.json()) as { id: number }

  const patchRes = await fetch(`${baseUrl}/tasks/${id}/status`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'done' }),
  })
  assert.equal(patchRes.status, 200, 'trivial task should transition to done')
})

test('E2E auth: request without X-AgentGuard-Token returns 401', async () => {
  const res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'no token', complexity: 'trivial' }),
  })
  assert.equal(res.status, 401, 'fail-closed auth must reject missing token')
})
