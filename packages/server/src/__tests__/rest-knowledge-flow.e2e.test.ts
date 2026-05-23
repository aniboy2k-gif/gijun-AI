import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')
process.env['AGENTGUARD_TOKEN'] = 'test-token-knowledge'

const { createApp } = await import('../app.js')
const core = await import('@gijun-ai/core')

const TOKEN = 'test-token-knowledge'
let server: Server
let baseUrl: string

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-AgentGuard-Token': TOKEN }
}

function makeCandidate(title: string): number {
  return core.createDaCandidate({
    title,
    content: `content for ${title}`,
    reasoning: `reasoning for ${title}`,
    targetLayer: 'project',
    project: 'e2e-knowledge',
  })
}

type KnowledgeRow = {
  id: number
  status: string | null
  is_active: number
  supersedes_id: number | null
}

function selectKnowledge(id: number): KnowledgeRow {
  const row = core.getDb()
    .prepare('SELECT id, status, is_active, supersedes_id FROM knowledge_items WHERE id = ?')
    .get(id) as KnowledgeRow | undefined
  if (!row) throw new Error(`knowledge ${id} not found`)
  return row
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

// =============================================================================
// Group A — Happy path 5 transitions
// =============================================================================

test('E2E knowledge: POST /knowledge/:id/nominate transitions draft → candidate (200)', async () => {
  const id = makeCandidate('A-nominate')
  const res = await fetch(`${baseUrl}/knowledge/${id}/nominate`, {
    method: 'POST', headers: authHeaders(),
  })
  assert.equal(res.status, 200, 'nominate must return 200')
  assert.equal(selectKnowledge(id).status, 'candidate', 'status must be candidate after nominate')
})

test('E2E knowledge: POST /knowledge/:id/approve transitions candidate → approved (200)', async () => {
  const id = makeCandidate('A-approve')
  await fetch(`${baseUrl}/knowledge/${id}/nominate`, { method: 'POST', headers: authHeaders() })

  const res = await fetch(`${baseUrl}/knowledge/${id}/approve`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'e2e approval' }),
  })
  assert.equal(res.status, 200, 'approve must return 200')
  assert.equal(selectKnowledge(id).status, 'approved', 'status must be approved')
})

test('E2E knowledge: POST /knowledge/:id/revoke transitions approved → rejected (200)', async () => {
  const id = makeCandidate('A-revoke')
  await fetch(`${baseUrl}/knowledge/${id}/nominate`, { method: 'POST', headers: authHeaders() })
  await fetch(`${baseUrl}/knowledge/${id}/approve`, { method: 'POST', headers: authHeaders(), body: '{}' })

  const res = await fetch(`${baseUrl}/knowledge/${id}/revoke`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'e2e revoke' }),
  })
  assert.equal(res.status, 200, 'revoke must return 200')
  assert.equal(selectKnowledge(id).status, 'rejected', 'status must be rejected')
})

test('E2E knowledge: POST /knowledge/:id/reject transitions draft → rejected (200)', async () => {
  const id = makeCandidate('A-reject-from-draft')
  const res = await fetch(`${baseUrl}/knowledge/${id}/reject`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'e2e reject from draft' }),
  })
  assert.equal(res.status, 200, 'reject must return 200')
  assert.equal(selectKnowledge(id).status, 'rejected', 'status must be rejected')
})

test('E2E knowledge: POST /knowledge/:id/restore creates new draft with supersedes_id (201)', async () => {
  const id = makeCandidate('A-restore')
  await fetch(`${baseUrl}/knowledge/${id}/reject`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'pre-restore reject' }),
  })

  const res = await fetch(`${baseUrl}/knowledge/${id}/restore`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'e2e restore' }),
  })
  assert.equal(res.status, 201, 'restore must return 201 Created')
  const { id: newId } = (await res.json()) as { id: number }
  assert.ok(newId > id, 'restored row must have new id')

  const restored = selectKnowledge(newId)
  assert.equal(restored.status, 'draft', 'restored row must be draft')
  assert.equal(restored.supersedes_id, id, 'supersedes_id must point to original rejected row')
})

// =============================================================================
// Group B — Illegal transitions (INVALID_STATE → 409)
// =============================================================================

test('E2E knowledge: nominate on approved item returns 409 INVALID_STATE', async () => {
  const id = makeCandidate('B-illegal-nominate')
  await fetch(`${baseUrl}/knowledge/${id}/nominate`, { method: 'POST', headers: authHeaders() })
  await fetch(`${baseUrl}/knowledge/${id}/approve`, { method: 'POST', headers: authHeaders(), body: '{}' })

  const res = await fetch(`${baseUrl}/knowledge/${id}/nominate`, {
    method: 'POST', headers: authHeaders(),
  })
  assert.equal(res.status, 409, 'illegal nominate (approved → candidate) must return 409')
  const body = (await res.json()) as { error: string }
  assert.equal(body.error, 'INVALID_STATE', 'error code must be INVALID_STATE')
})

test('E2E knowledge: approve on draft item returns 409 INVALID_STATE', async () => {
  const id = makeCandidate('B-illegal-approve')
  const res = await fetch(`${baseUrl}/knowledge/${id}/approve`, {
    method: 'POST', headers: authHeaders(), body: '{}',
  })
  assert.equal(res.status, 409, 'illegal approve (draft → approved) must return 409')
  const body = (await res.json()) as { error: string }
  assert.equal(body.error, 'INVALID_STATE')
})

test('E2E knowledge: revoke on draft item returns 409 INVALID_STATE', async () => {
  const id = makeCandidate('B-illegal-revoke')
  const res = await fetch(`${baseUrl}/knowledge/${id}/revoke`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'illegal revoke' }),
  })
  assert.equal(res.status, 409, 'illegal revoke (draft → rejected) must return 409')
  const body = (await res.json()) as { error: string }
  assert.equal(body.error, 'INVALID_STATE')
})

test('E2E knowledge: reject on approved item returns 409 INVALID_STATE', async () => {
  const id = makeCandidate('B-illegal-reject')
  await fetch(`${baseUrl}/knowledge/${id}/nominate`, { method: 'POST', headers: authHeaders() })
  await fetch(`${baseUrl}/knowledge/${id}/approve`, { method: 'POST', headers: authHeaders(), body: '{}' })

  const res = await fetch(`${baseUrl}/knowledge/${id}/reject`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'illegal reject' }),
  })
  assert.equal(res.status, 409, 'illegal reject (approved → rejected via /reject) must return 409')
  const body = (await res.json()) as { error: string }
  assert.equal(body.error, 'INVALID_STATE')
})

// =============================================================================
// Group C — compare-and-swap lost-update prevention
// =============================================================================

test('E2E knowledge: concurrent nominate on same draft — only one succeeds (CAS)', async () => {
  const id = makeCandidate('C-cas-nominate')

  // Fire two nominate calls concurrently. better-sqlite3 serializes via
  // BEGIN IMMEDIATE write lock, so the second one observes status='candidate'
  // and the CAS condition (`WHERE id=? AND status='draft'`) matches 0 rows →
  // INVALID_STATE 409.
  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/knowledge/${id}/nominate`, { method: 'POST', headers: authHeaders() }),
    fetch(`${baseUrl}/knowledge/${id}/nominate`, { method: 'POST', headers: authHeaders() }),
  ])
  const statuses = [resA.status, resB.status].sort((a, b) => a - b)
  assert.deepEqual(statuses, [200, 409], 'exactly one nominate must succeed, the other must 409')
  assert.equal(selectKnowledge(id).status, 'candidate', 'final status must be candidate')
})

// =============================================================================
// Group D — audit event 박제 검증
// =============================================================================

test('E2E knowledge: nominate emits knowledge.candidate_nominated audit event', async () => {
  const id = makeCandidate('D-audit-nominate')
  await fetch(`${baseUrl}/knowledge/${id}/nominate`, { method: 'POST', headers: authHeaders() })

  const evt = await findAuditEvent('knowledge.candidate_nominated', id)
  assert.ok(evt, `expected knowledge.candidate_nominated event for resource ${id}`)
  const payload = JSON.parse(evt.payload) as { from_status: string; to_status: string }
  assert.equal(payload.from_status, 'draft')
  assert.equal(payload.to_status, 'candidate')
})

test('E2E knowledge: approve emits knowledge.candidate_approved audit event', async () => {
  const id = makeCandidate('D-audit-approve')
  await fetch(`${baseUrl}/knowledge/${id}/nominate`, { method: 'POST', headers: authHeaders() })
  await fetch(`${baseUrl}/knowledge/${id}/approve`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'audit-test approve' }),
  })

  const evt = await findAuditEvent('knowledge.candidate_approved', id)
  assert.ok(evt, `expected knowledge.candidate_approved event for resource ${id}`)
  const payload = JSON.parse(evt.payload) as { from_status: string; to_status: string; reason: string }
  assert.equal(payload.to_status, 'approved')
  assert.equal(payload.reason, 'audit-test approve')
})

test('E2E knowledge: restore emits knowledge.restored_from_rejected audit event', async () => {
  const id = makeCandidate('D-audit-restore')
  await fetch(`${baseUrl}/knowledge/${id}/reject`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'pre-restore' }),
  })
  const restoreRes = await fetch(`${baseUrl}/knowledge/${id}/restore`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'audit-test restore' }),
  })
  const { id: newId } = (await restoreRes.json()) as { id: number }

  const evt = await findAuditEvent('knowledge.restored_from_rejected', newId)
  assert.ok(evt, `expected knowledge.restored_from_rejected event for resource ${newId}`)
  const payload = JSON.parse(evt.payload) as { original_id: number; new_id: number }
  assert.equal(payload.original_id, id, 'audit payload must record original rejected id')
  assert.equal(payload.new_id, newId, 'audit payload must record new draft id')
})

// =============================================================================
// Group E — is_active sync + supersedes_id chain
// =============================================================================

test('E2E knowledge: approve sets is_active=1, revoke sets is_active=0', async () => {
  const id = makeCandidate('E-is-active')
  await fetch(`${baseUrl}/knowledge/${id}/nominate`, { method: 'POST', headers: authHeaders() })
  await fetch(`${baseUrl}/knowledge/${id}/approve`, { method: 'POST', headers: authHeaders(), body: '{}' })

  assert.equal(selectKnowledge(id).is_active, 1, 'approved row must have is_active=1')

  await fetch(`${baseUrl}/knowledge/${id}/revoke`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'flip is_active' }),
  })
  assert.equal(selectKnowledge(id).is_active, 0, 'revoked row must have is_active=0')
})

test('E2E knowledge: rejected from draft sets is_active=0; restore creates new active draft', async () => {
  const id = makeCandidate('E-supersedes-chain')
  await fetch(`${baseUrl}/knowledge/${id}/reject`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ reason: 'chain reject' }),
  })
  assert.equal(selectKnowledge(id).is_active, 0, 'rejected row must have is_active=0')

  const restoreRes = await fetch(`${baseUrl}/knowledge/${id}/restore`, {
    method: 'POST', headers: authHeaders(), body: '{}',
  })
  const { id: newId } = (await restoreRes.json()) as { id: number }

  const restored = selectKnowledge(newId)
  assert.equal(restored.status, 'draft', 'restored row must be status=draft')
  assert.equal(restored.is_active, 1, 'restored draft row must have is_active=1 (default)')
  assert.equal(restored.supersedes_id, id, 'supersedes_id must point to the original rejected id')

  // The original row stays immutable (rejected, is_active=0)
  const original = selectKnowledge(id)
  assert.equal(original.status, 'rejected', 'original row must remain rejected after restore')
  assert.equal(original.is_active, 0, 'original row must remain is_active=0 after restore')
})
