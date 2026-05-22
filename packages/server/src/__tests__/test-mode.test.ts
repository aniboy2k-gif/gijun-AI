// RED skeleton for CSR #775 P1 C2: AGENTGUARD_TEST_MODE HMAC Key Management
// Plan v2 reference: ~/workspace/gijun-ai/prompt_plan.md §P1
// Note: auth/test-mode.ts does not exist yet — these tests should FAIL at import time

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

process.env['NODE_ENV'] = 'test'
process.env['AGENTGUARD_CONFIG_HMAC_KEY'] =
  crypto.randomBytes(32).toString('hex')

// Module under test — RED: file does not exist yet
const testModeMod = await import('../auth/test-mode.js')
const { validTestMode, generateTestMode, getBootEpoch } = testModeMod

test('validTestMode: returns false when token is undefined', () => {
  assert.equal(validTestMode(undefined), false)
})

test('validTestMode: returns false when token is empty string', () => {
  assert.equal(validTestMode(''), false)
})

test('validTestMode: returns true for valid token with current boot_epoch', () => {
  const ttlMs = Date.now() + 60_000
  const token = generateTestMode(ttlMs)
  assert.equal(validTestMode(token), true)
})

test('validTestMode: returns false for replay token (different boot_epoch)', () => {
  // Simulate previous boot by manually crafting payload with old epoch
  const HMAC_KEY = process.env['AGENTGUARD_CONFIG_HMAC_KEY']!
  const oldEpoch = getBootEpoch() - 1000 // 1 sec before current boot
  const payload = Buffer.from(
    JSON.stringify({ epoch: oldEpoch, ttl: Date.now() + 60_000 })
  ).toString('base64')
  const signature = crypto
    .createHmac('sha256', HMAC_KEY)
    .update(payload)
    .digest('hex')
  const token = `${payload}.${signature}`
  assert.equal(validTestMode(token), false, 'replay must be rejected')
})

test('validTestMode: returns false for expired TTL', () => {
  const expiredTtl = Date.now() - 1000 // already expired
  const token = generateTestMode(expiredTtl)
  assert.equal(validTestMode(token), false, 'expired TTL must be rejected')
})

test('validTestMode: returns false for tampered signature', () => {
  const ttlMs = Date.now() + 60_000
  const token = generateTestMode(ttlMs)
  const [payload] = token.split('.')
  // Forge signature with wrong key
  const wrongKey = crypto.randomBytes(32).toString('hex')
  const forgedSig = crypto
    .createHmac('sha256', wrongKey)
    .update(payload!)
    .digest('hex')
  const forgedToken = `${payload}.${forgedSig}`
  assert.equal(validTestMode(forgedToken), false, 'tampered signature must be rejected')
})

test('validTestMode: returns false for malformed token (missing dot)', () => {
  assert.equal(validTestMode('malformed-no-dot'), false)
})

test('validTestMode: returns false for malformed token (empty payload)', () => {
  assert.equal(validTestMode('.signature-only'), false)
})

test('getBootEpoch: returns a number (monotonic boot counter)', () => {
  const epoch = getBootEpoch()
  assert.equal(typeof epoch, 'number')
  assert.ok(epoch > 0)
})

test('generateTestMode: returns a string in payload.signature format', () => {
  const ttlMs = Date.now() + 60_000
  const token = generateTestMode(ttlMs)
  assert.equal(typeof token, 'string')
  const parts = token.split('.')
  assert.equal(parts.length, 2, 'token must be payload.signature format')
  assert.ok(parts[0]!.length > 0, 'payload must be non-empty')
  assert.equal(parts[1]!.length, 64, 'signature must be sha256 hex (64 chars)')
})
