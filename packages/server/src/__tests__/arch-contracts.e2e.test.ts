// Architecture contract verification — E2E assertions for contracts #4 and #5.
// Reference: README "Architecture contracts" table.
//
// Contract #4: Fail-closed authentication
//   - server.ts exits with code 1 when AGENTGUARD_TOKEN is unset
//   - every route (except /health) returns 401 without the token
//   - /health does NOT require the token
//
// Contract #5: Local-only binding
//   - server listens on 127.0.0.1, never on 0.0.0.0 or ::

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = resolve(__dirname, '../../../../migrations')

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = MIGRATIONS
process.env['AGENTGUARD_TOKEN'] = 'test-token-contracts'

const { createApp } = await import('../app.js')
const core = await import('@gijun-ai/core')

const TOKEN = 'test-token-contracts'
let server: Server
let baseUrl: string

function auth(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-AgentGuard-Token': TOKEN }
}

before(async () => {
  core.runMigrations()
  const app = createApp()
  await new Promise<void>((res) => {
    server = app.listen(0, '127.0.0.1', () => res())
  })
  const addr = server.address()
  if (typeof addr !== 'object' || addr === null) throw new Error('unexpected address')
  baseUrl = `http://127.0.0.1:${addr.port}`
})

after(async () => {
  await new Promise<void>((res) => { server.close(() => res()) })
  core.closeDb()
})

// ── Contract #4: Fail-closed auth ────────────────────────────────────────────

test('Contract #4: server.ts exits 1 when AGENTGUARD_TOKEN is not set', () => {
  // Spawn a child process that runs server.ts entry without the token.
  // We cannot import server.ts directly (it calls process.exit), so use spawnSync.
  const serverEntry = resolve(__dirname, '../server.js')
  const result = spawnSync(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      AGENTGUARD_TOKEN: '',         // unset
      GIJUN_DB_PATH: ':memory:',
      GIJUN_MIGRATIONS_PATH: MIGRATIONS,
    },
    timeout: 3000,
  })
  assert.equal(result.status, 1, 'server must exit with code 1 when token is missing')
  const stderr = result.stderr.toString()
  assert.ok(
    stderr.includes('AGENTGUARD_TOKEN') || stderr.includes('FATAL'),
    `stderr should mention AGENTGUARD_TOKEN or FATAL, got: ${stderr.slice(0, 200)}`,
  )
})

test('Contract #4: /health responds 200 without authentication token', async () => {
  const res = await fetch(`${baseUrl}/health`)
  assert.equal(res.status, 200, '/health must not require auth')
})

test('Contract #4: GET /tasks returns 401 without token', async () => {
  const res = await fetch(`${baseUrl}/tasks`)
  assert.equal(res.status, 401, 'unauthenticated request must be rejected')
})

test('Contract #4: POST /tasks returns 401 without token', async () => {
  const res = await fetch(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ complexity: 'trivial' }),
  })
  assert.equal(res.status, 401, 'unauthenticated POST must be rejected')
})

test('Contract #4: GET /tasks returns 200 with valid token', async () => {
  const res = await fetch(`${baseUrl}/tasks`, { headers: auth() })
  assert.equal(res.status, 200, 'authenticated request must succeed')
})

// ── Contract #5: Local-only binding ──────────────────────────────────────────

test('Contract #5: server binds to 127.0.0.1, not 0.0.0.0', () => {
  const addr = server.address()
  assert.ok(typeof addr === 'object' && addr !== null, 'address should be an object')
  assert.equal(
    (addr as { address: string }).address,
    '127.0.0.1',
    'server must bind to 127.0.0.1 only',
  )
})

test('Contract #5: server address is IPv4 loopback — not wildcard (0.0.0.0 or ::)', () => {
  const addr = server.address()
  assert.ok(typeof addr === 'object' && addr !== null)
  const bound = addr as { address: string }
  // Wildcard addresses would expose the server on all network interfaces.
  assert.notEqual(bound.address, '0.0.0.0', 'must not bind to all IPv4 interfaces')
  assert.notEqual(bound.address, '::', 'must not bind to all IPv6 interfaces')
})
