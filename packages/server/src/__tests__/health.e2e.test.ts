import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')
process.env['AGENTGUARD_TOKEN'] = 'test-token-health'

const { createApp } = await import('../app.js')
const core = await import('@gijun-ai/core')

let server: Server
let baseUrl: string

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

test('E2E health: /health returns package.json version (no 0.1.0 drift)', async () => {
  const res = await fetch(`${baseUrl}/health`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { ok: boolean; version: string }
  assert.equal(body.ok, true)

  // Assert version matches root package.json — prevents the v0.1.0 drift
  // where app.ts hardcoded a stale version.
  const rootPkgPath = resolve(__dirname, '../../../../package.json')
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as { version: string }
  assert.equal(
    body.version,
    rootPkg.version,
    `/health version (${body.version}) must match root package.json (${rootPkg.version})`,
  )
})

test('E2E health: /health does not require auth token', async () => {
  // Confirm fail-closed auth contract exempts /health only
  const res = await fetch(`${baseUrl}/health`)
  assert.equal(res.status, 200)
})
