// RED skeleton for CSR #775 P2 C1: env-file.ts integration with AGENTGUARD_TEST_MODE HMAC
// Plan v2 reference: ~/workspace/gijun-ai/prompt_plan.md §P2
// Note: env-file.ts currently allows AGENTGUARD_ENV_FILE when NODE_ENV=test only.
// After C1 fix, it MUST additionally require valid AGENTGUARD_TEST_MODE HMAC token.

import { test, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

// Set env BEFORE any module import that captures process.env at load time
process.env['NODE_ENV'] = 'test'
process.env['AGENTGUARD_CONFIG_HMAC_KEY'] =
  crypto.randomBytes(32).toString('hex')

const TMP_DIR = mkdtempSync(resolve(tmpdir(), 'gijun-c1-test-'))
const TEST_ENV_FILE = resolve(TMP_DIR, '.env.local')
writeFileSync(TEST_ENV_FILE, 'AGENTGUARD_TOKEN=initial\n')

// Dynamic import after env setup
const { generateTestMode } = await import('../auth/test-mode.js')
const envFileMod = await import('../auth/env-file.js')
const { resolveEnvFilePath, EnvFileError } = envFileMod

beforeEach(() => {
  delete process.env['AGENTGUARD_ENV_FILE']
  delete process.env['AGENTGUARD_TEST_MODE']
})

afterEach(() => {
  delete process.env['AGENTGUARD_ENV_FILE']
  delete process.env['AGENTGUARD_TEST_MODE']
})

before(() => {
  // Module loaded in test mode — verify
  assert.equal(process.env['NODE_ENV'], 'test')
  assert.ok(process.env['AGENTGUARD_CONFIG_HMAC_KEY'])
})

// Cleanup TMP_DIR at process exit
process.on('exit', () => {
  try {
    rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

test('C1: AGENTGUARD_ENV_FILE without HMAC token in test env → throws', () => {
  process.env['AGENTGUARD_ENV_FILE'] = TEST_ENV_FILE
  // No AGENTGUARD_TEST_MODE — should throw
  assert.throws(
    () => resolveEnvFilePath(),
    (err: unknown) => {
      assert.ok(err instanceof EnvFileError)
      assert.match(
        (err as InstanceType<typeof EnvFileError>).code,
        /env_file_override_missing_valid_hmac|env_file_override_missing_hmac/,
        'must throw HMAC-missing error code',
      )
      return true
    },
    'AGENTGUARD_ENV_FILE without HMAC token must throw',
  )
})

test('C1: AGENTGUARD_ENV_FILE with invalid HMAC token in test env → throws', () => {
  process.env['AGENTGUARD_ENV_FILE'] = TEST_ENV_FILE
  process.env['AGENTGUARD_TEST_MODE'] = 'invalid.hmac-token-forged'
  assert.throws(
    () => resolveEnvFilePath(),
    (err: unknown) => {
      assert.ok(err instanceof EnvFileError)
      assert.match(
        (err as InstanceType<typeof EnvFileError>).code,
        /env_file_override_invalid_hmac|env_file_override_missing_valid_hmac/,
        'must throw invalid-HMAC error code',
      )
      return true
    },
    'AGENTGUARD_ENV_FILE with invalid HMAC token must throw',
  )
})

test('C1: AGENTGUARD_ENV_FILE with valid HMAC token in test env → returns path', () => {
  process.env['AGENTGUARD_ENV_FILE'] = TEST_ENV_FILE
  process.env['AGENTGUARD_TEST_MODE'] = generateTestMode(Date.now() + 60_000)
  const path = resolveEnvFilePath()
  assert.equal(path, TEST_ENV_FILE, 'valid HMAC must allow path resolution')
})

test('C1: No AGENTGUARD_ENV_FILE → returns default .env.local in cwd', () => {
  const path = resolveEnvFilePath()
  assert.match(path, /\.env\.local$/, 'must end with .env.local')
})

test('C1: AGENTGUARD_ENV_FILE with expired HMAC token → throws', () => {
  process.env['AGENTGUARD_ENV_FILE'] = TEST_ENV_FILE
  process.env['AGENTGUARD_TEST_MODE'] = generateTestMode(Date.now() - 1000) // expired
  assert.throws(
    () => resolveEnvFilePath(),
    (err: unknown) => {
      assert.ok(err instanceof EnvFileError)
      assert.match(
        (err as InstanceType<typeof EnvFileError>).code,
        /env_file_override_invalid_hmac|env_file_override_missing_valid_hmac/,
        'expired HMAC token must throw',
      )
      return true
    },
    'AGENTGUARD_ENV_FILE with expired HMAC must throw',
  )
})
