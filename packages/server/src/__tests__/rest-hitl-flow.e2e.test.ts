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

test('E2E HITL reject: critical task PATCH cancelled does not require approval', async () => {
  // Reject path: a task that requires HITL approval can be cancelled without
  // prior approval. This is the backend contract behind the web "거부" button.
  // Note: createTask sets status='pending'; hitl_required=1 is the signal
  // the UI should match on (not status==='hitl_wait', which is only reached
  // via explicit PATCH).
  const createRes = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      title: 'e2e reject task',
      complexity: 'critical',
      toolName: 'bash',
      actionType: 'execute',
      resource: 'prod-db',
    }),
  })
  assert.equal(createRes.status, 201, 'task creation should succeed (201 Created)')
  const { id } = (await createRes.json()) as { id: number }

  // Initial state: status='pending', hitl_required=1, hitl_approved_at=null.
  // This is what the UI sees as the "needs HITL" condition.
  const getBefore = await fetch(`${baseUrl}/tasks/${id}`, { headers: authHeaders() })
  const before = (await getBefore.json()) as {
    status: string; hitl_required: number; hitl_approved_at: string | null
  }
  assert.equal(before.status, 'pending', 'critical task starts in status=pending')
  assert.equal(before.hitl_required, 1, 'critical task must have hitl_required=1')
  assert.equal(before.hitl_approved_at, null, 'critical task starts unapproved')

  // PATCH to cancelled — should succeed without hitl-approve
  const cancelRes = await fetch(`${baseUrl}/tasks/${id}/status`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'cancelled' }),
  })
  assert.equal(
    cancelRes.status,
    200,
    'cancelled transition should succeed without prior approval',
  )

  // Verify the state actually changed
  const getAfter = await fetch(`${baseUrl}/tasks/${id}`, { headers: authHeaders() })
  const after = (await getAfter.json()) as { status: string; hitl_approved_at: string | null }
  assert.equal(after.status, 'cancelled', 'task status should be cancelled')
  assert.equal(after.hitl_approved_at, null, 'cancelled task should not have hitl_approved_at')
})

test('E2E HITL trigger payload: hitl_trigger field is JSON with axes string[]', async () => {
  // The web UI parses task.hitl_trigger to display the reason in Korean.
  // This locks the API contract: hitl_trigger is a JSON string containing
  // { axes: string[] } — each entry is the axis code itself (e.g.
  // 'critical_complexity'), NOT an object with a `reason` field. This is the
  // shape produced by evaluateTaskHitl() in packages/core/src/hitl/gate.ts.
  const createRes = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      title: 'e2e trigger payload',
      complexity: 'critical',
      toolName: 'bash',
      actionType: 'execute',
      resource: 'prod-db',
    }),
  })
  const { id } = (await createRes.json()) as { id: number }

  const getRes = await fetch(`${baseUrl}/tasks/${id}`, { headers: authHeaders() })
  const task = (await getRes.json()) as { hitl_trigger: string | null }
  assert.ok(task.hitl_trigger, 'critical task must record a hitl_trigger payload')

  const parsed = JSON.parse(task.hitl_trigger as string) as { axes?: string[] }
  assert.ok(Array.isArray(parsed.axes), 'hitl_trigger must contain an axes array')
  assert.ok(parsed.axes.length > 0, 'critical task must have at least one axis')
  assert.ok(
    parsed.axes.includes('critical_complexity'),
    `expected 'critical_complexity' in axes, got ${JSON.stringify(parsed.axes)}`,
  )
  // Lock the string-array shape: each entry must be a plain string code,
  // not an object. This is what TasksTab.formatTrigger() relies on.
  for (const axis of parsed.axes) {
    assert.equal(typeof axis, 'string', `axes entry must be string, got ${typeof axis}`)
  }
})
