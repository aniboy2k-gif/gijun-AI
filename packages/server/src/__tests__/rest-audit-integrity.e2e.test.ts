import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')
process.env['AGENTGUARD_TOKEN'] = 'test-token-audit-integrity'

const { createApp } = await import('../app.js')
const core = await import('@gijun-ai/core')

const TOKEN = 'test-token-audit-integrity'
let server: Server
let baseUrl: string

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-AgentGuard-Token': TOKEN }
}

async function appendEvent(label: string, payload: Record<string, unknown> = {}): Promise<number> {
  const res = await fetch(`${baseUrl}/audit`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      eventType: 'e2e.audit-integrity',
      actor: 'system',
      action: label,
      payload,
    }),
  })
  assert.equal(res.status, 201, `append '${label}' must return 201`)
  const body = (await res.json()) as { id: number }
  return body.id
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

test('E2E audit integrity: new events are stored with original_hash_type=redaction_pre', async () => {
  const id = await appendEvent('original-hash-type test')

  type Row = { original_hash_type: string; original_hash: string | null }
  const row = core.getDb()
    .prepare('SELECT original_hash_type, original_hash FROM audit_events WHERE id = ?')
    .get(id) as Row | undefined

  assert.ok(row, `audit row ${id} must exist`)
  assert.equal(
    row.original_hash_type,
    'redaction_pre',
    'new appends must mark original_hash_type=redaction_pre (post-migration-002)',
  )
  assert.ok(row.original_hash, 'original_hash must be populated for redaction_pre rows')
})

test('E2E audit integrity: redaction masks sensitive payload while keeping chain valid', async () => {
  // Append an event carrying both a sensitive key name AND a token-shaped value.
  // redactPayload should replace both with [REDACTED]. Because chain_hash is
  // derived from original_hash (unredacted), the chain stays valid afterward.
  const secret = 'sk-' + 'A'.repeat(40)
  const id = await appendEvent('redaction test', {
    token: secret,
    note: 'plaintext note remains',
  })

  type Row = { payload: string }
  const row = core.getDb()
    .prepare('SELECT payload FROM audit_events WHERE id = ?')
    .get(id) as Row | undefined
  assert.ok(row, `audit row ${id} must exist`)
  const stored = JSON.parse(row.payload) as { token: string; note: string }
  assert.equal(stored.token, '[REDACTED]', 'sensitive key must be redacted in stored payload')
  assert.equal(stored.note, 'plaintext note remains', 'non-sensitive fields must be preserved')
  assert.ok(
    !row.payload.includes(secret),
    'raw sk-token must not appear in stored payload',
  )

  // Chain must still verify clean after redaction.
  const checkRes = await fetch(`${baseUrl}/audit/integrity-check`, { headers: authHeaders() })
  assert.equal(checkRes.status, 200, 'integrity-check must return 200 when chain is valid')
  const result = (await checkRes.json()) as { valid: boolean; broken: unknown[] }
  assert.equal(result.valid, true, 'chain must remain valid after redaction')
  assert.deepEqual(result.broken, [], 'no broken links expected after redaction')
})

test('E2E audit integrity: tampering with prev_hash flips integrity-check to 409 valid=false', async () => {
  // Append three events to build a multi-row chain segment for this test.
  const id1 = await appendEvent('tamper baseline 1')
  const id2 = await appendEvent('tamper baseline 2')
  const id3 = await appendEvent('tamper baseline 3')
  assert.ok(id3 > id2 && id2 > id1, 'audit ids must be monotonically increasing')

  // Capture the original prev_hash of the middle row so we can restore the
  // chain at the end of this test (so subsequent tests, if any are added,
  // start from a clean chain). The :memory: DB is also fresh per file, but
  // the cleanup discipline keeps the test self-contained.
  type HashRow = { prev_hash: string }
  const originalPrevHash = (
    core.getDb()
      .prepare('SELECT prev_hash FROM audit_events WHERE id = ?')
      .get(id2) as HashRow
  ).prev_hash

  // Tamper: replace the middle row's prev_hash with a clearly invalid value.
  const tampered = 'f'.repeat(64)
  core.getDb()
    .prepare('UPDATE audit_events SET prev_hash = ? WHERE id = ?')
    .run(tampered, id2)

  const checkRes = await fetch(`${baseUrl}/audit/integrity-check`, { headers: authHeaders() })
  assert.equal(
    checkRes.status,
    409,
    'integrity-check must return 409 when the chain is broken',
  )
  const result = (await checkRes.json()) as {
    valid: boolean
    broken: Array<{ kind: string; id?: number }>
  }
  assert.equal(result.valid, false, 'tampered chain must report valid=false')
  assert.ok(
    result.broken.some((b) => b.kind === 'linkage' && b.id === id2),
    `broken array must include linkage failure for id=${id2}, got ${JSON.stringify(result.broken)}`,
  )

  // Restore the chain so this test does not corrupt state for later tests.
  core.getDb()
    .prepare('UPDATE audit_events SET prev_hash = ? WHERE id = ?')
    .run(originalPrevHash, id2)
  const restoreRes = await fetch(`${baseUrl}/audit/integrity-check`, { headers: authHeaders() })
  assert.equal(restoreRes.status, 200, 'chain must be valid again after prev_hash restore')
})
