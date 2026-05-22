import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))

const INITIAL_TOKEN = 'test-token-rotate-initial'
const TMP_DIR = mkdtempSync(resolve(tmpdir(), 'gijun-rotate-test-'))
const ENV_FILE = resolve(TMP_DIR, '.env.local')

process.env['NODE_ENV'] = 'test'
process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')
process.env['AGENTGUARD_TOKEN'] = INITIAL_TOKEN
process.env['AGENTGUARD_ENV_FILE'] = ENV_FILE

const { createApp } = await import('../app.js')
const core = await import('@gijun-ai/core')
const tokenHolder = await import('../auth/token-holder.js')
const envFile = await import('../auth/env-file.js')

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
  try { rmSync(TMP_DIR, { recursive: true, force: true }) } catch {}
  delete process.env['NODE_ENV']
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
  delete process.env['AGENTGUARD_TOKEN']
  delete process.env['AGENTGUARD_ENV_FILE']
})

beforeEach(() => {
  tokenHolder._resetForTests(INITIAL_TOKEN)
  writeFileSync(ENV_FILE, `AGENTGUARD_TOKEN=${INITIAL_TOKEN}\n`, { mode: 0o600 })
})

function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-AgentGuard-Token': token, ...extra }
}

test('rotate happy path: returns new token, old token works in grace, env file updated', async () => {
  // C2/L1 Red sentinel: confirm initial state — old token works
  const r0 = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(INITIAL_TOKEN) })
  assert.equal(r0.status, 200)

  const r1 = await fetch(`${baseUrl}/auth/rotate-token`, {
    method: 'POST',
    headers: authHeaders(INITIAL_TOKEN, { 'X-AgentGuard-Confirm-Rotate': 'yes' }),
  })
  assert.equal(r1.status, 200)
  const body = (await r1.json()) as { token: string; rotated_at: string }
  assert.notEqual(body.token, INITIAL_TOKEN)
  assert.match(body.token, /^[0-9a-f]{64}$/)
  assert.equal(typeof body.rotated_at, 'string')

  // .env.local updated atomically
  const contents = readFileSync(ENV_FILE, 'utf-8')
  assert.ok(contents.includes(`AGENTGUARD_TOKEN=${body.token}`),
    `.env.local must contain new token, got: ${contents.slice(0, 200)}`)
  assert.ok(!contents.includes(`AGENTGUARD_TOKEN=${INITIAL_TOKEN}`),
    `.env.local must not contain old token after rotation`)

  // Old token still valid during 5s grace
  const r2 = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(INITIAL_TOKEN) })
  assert.equal(r2.status, 200, 'old token must work during grace window')

  // New token works immediately
  const r3 = await fetch(`${baseUrl}/tasks`, { headers: authHeaders(body.token) })
  assert.equal(r3.status, 200, 'new token must work immediately')

  // No-store header on rotate response
  assert.match(r1.headers.get('cache-control') ?? '', /no-store/)
})

test('rotate without confirmation header returns 403', async () => {
  const r = await fetch(`${baseUrl}/auth/rotate-token`, {
    method: 'POST',
    headers: authHeaders(INITIAL_TOKEN),
  })
  assert.equal(r.status, 403)
  const body = (await r.json()) as { error: string }
  assert.equal(body.error, 'confirmation_header_missing')
})

test('rotate with foreign Origin returns 403', async () => {
  const r = await fetch(`${baseUrl}/auth/rotate-token`, {
    method: 'POST',
    headers: authHeaders(INITIAL_TOKEN, {
      'X-AgentGuard-Confirm-Rotate': 'yes',
      'Origin': 'https://evil.example.com',
    }),
  })
  assert.equal(r.status, 403)
  const body = (await r.json()) as { error: string }
  assert.equal(body.error, 'origin_forbidden')
})

test('rotate with localhost Origin passes', async () => {
  const r = await fetch(`${baseUrl}/auth/rotate-token`, {
    method: 'POST',
    headers: authHeaders(INITIAL_TOKEN, {
      'X-AgentGuard-Confirm-Rotate': 'yes',
      'Origin': 'http://localhost:5173',
    }),
  })
  assert.equal(r.status, 200)
})

test('rotate without auth token returns 401', async () => {
  const r = await fetch(`${baseUrl}/auth/rotate-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AgentGuard-Confirm-Rotate': 'yes' },
  })
  assert.equal(r.status, 401)
})

test('audit chain integrity preserved after rotation', async () => {
  await fetch(`${baseUrl}/auth/rotate-token`, {
    method: 'POST',
    headers: authHeaders(INITIAL_TOKEN, { 'X-AgentGuard-Confirm-Rotate': 'yes' }),
  })
  const r = await fetch(`${baseUrl}/audit/integrity-check`, { headers: authHeaders(INITIAL_TOKEN) })
  assert.equal(r.status, 200)
  const body = (await r.json()) as { valid: boolean; total: number }
  assert.equal(body.valid, true, 'chain must remain valid after token_rotated event')
  assert.ok(body.total >= 1, 'must have at least 1 audit event')
})

test('audit event for rotation is recorded with redacted payload', async () => {
  const before = await fetch(`${baseUrl}/audit?n=5`, { headers: authHeaders(INITIAL_TOKEN) })
  const beforeRows = (await before.json()) as Array<{ id: number }>
  const beforeMax = beforeRows.length ? Math.max(...beforeRows.map(r => r.id)) : 0

  await fetch(`${baseUrl}/auth/rotate-token`, {
    method: 'POST',
    headers: authHeaders(INITIAL_TOKEN, { 'X-AgentGuard-Confirm-Rotate': 'yes' }),
  })

  const after = await fetch(`${baseUrl}/audit?n=5`, { headers: authHeaders(INITIAL_TOKEN) })
  const afterRows = (await after.json()) as Array<{
    id: number; event_type: string; action: string; payload: string
  }>
  const newRows = afterRows.filter(r => r.id > beforeMax)
  const rotationRow = newRows.find(r => r.event_type === 'auth' && r.action === 'token_rotated')
  assert.ok(rotationRow, 'token_rotated audit event must be recorded')
  const parsed = JSON.parse(rotationRow.payload) as Record<string, unknown>
  assert.equal(parsed.old_token, '[REDACTED]')
  assert.equal(parsed.new_token, '[REDACTED]')
  assert.equal(parsed.initiated_by, 'http_endpoint')
})

test('concurrent rotate: second call returns 409', async () => {
  // Acquire the lock manually to simulate in-flight state.
  // Real concurrency is hard to guarantee with sync handlers; this verifies
  // the lock primitive directly.
  assert.equal(tokenHolder.acquireRotateLock(), true)
  try {
    const r = await fetch(`${baseUrl}/auth/rotate-token`, {
      method: 'POST',
      headers: authHeaders(INITIAL_TOKEN, { 'X-AgentGuard-Confirm-Rotate': 'yes' }),
    })
    assert.equal(r.status, 409)
    const body = (await r.json()) as { error: string }
    assert.equal(body.error, 'rotation_in_progress')
  } finally {
    tokenHolder.releaseRotateLock()
  }
})

test('env_file symlink refuses write', async () => {
  // Create symlink as env file target
  const target = resolve(TMP_DIR, '.env.local.target')
  writeFileSync(target, 'AGENTGUARD_TOKEN=symlink-target\n', { mode: 0o600 })
  rmSync(ENV_FILE, { force: true })
  const { symlinkSync } = await import('node:fs')
  symlinkSync(target, ENV_FILE)

  try {
    const r = await fetch(`${baseUrl}/auth/rotate-token`, {
      method: 'POST',
      headers: authHeaders(INITIAL_TOKEN, { 'X-AgentGuard-Confirm-Rotate': 'yes' }),
    })
    assert.equal(r.status, 500)
    const body = (await r.json()) as { error: string }
    assert.equal(body.error, 'env_file_is_symlink')
  } finally {
    rmSync(ENV_FILE, { force: true })
    rmSync(target, { force: true })
  }
})

test('sweep removes lingering .env.local.tmp.* files on boot', async () => {
  const tmpStale = resolve(TMP_DIR, '.env.local.tmp.99999.1234567890')
  writeFileSync(tmpStale, 'leftover')
  assert.equal(existsSync(tmpStale), true)
  const removed = envFile.sweepTmpFiles()
  assert.ok(removed >= 1, 'sweep must remove at least 1 stale tmp file')
  assert.equal(existsSync(tmpStale), false)
})

test('AGENTGUARD_ENV_FILE override is rejected in non-test NODE_ENV', async () => {
  const original = process.env['NODE_ENV']
  process.env['NODE_ENV'] = 'production'
  try {
    assert.throws(
      () => envFile.resolveEnvFilePath(),
      (err: unknown) => err instanceof envFile.EnvFileError && err.code === 'env_file_override_in_non_test',
    )
  } finally {
    process.env['NODE_ENV'] = original
  }
})

test('isTokenValid edge cases: undefined, empty, wrong length', () => {
  tokenHolder._resetForTests('correct-token-value')
  assert.equal(tokenHolder.isTokenValid(undefined), false)
  assert.equal(tokenHolder.isTokenValid(null), false)
  assert.equal(tokenHolder.isTokenValid(''), false)
  assert.equal(tokenHolder.isTokenValid('x'), false)
  assert.equal(tokenHolder.isTokenValid('wrong-token-value-x'), false)
  assert.equal(tokenHolder.isTokenValid('correct-token-value'), true)
})
