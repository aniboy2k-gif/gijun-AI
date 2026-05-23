// CSR #780 Phase 1: verify that redact.ts extraction preserves all original behaviour.
// These tests must pass BOTH before extraction (importing from audit/service.ts
// when the helpers are re-exported there) and after (importing from audit/redact.ts
// directly) — ensuring zero regression from the refactor.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { redactPayload } from '../audit/redact.js'

test('redact-extract: value-pattern — OpenAI sk- token is redacted', () => {
  const result = redactPayload({ message: 'key=sk-abc123ABCDEF456789xyz012345' })
  assert.ok(
    !JSON.stringify(result).includes('sk-abc123'),
    `token must be redacted: ${JSON.stringify(result)}`,
  )
  assert.ok(JSON.stringify(result).includes('[REDACTED]'), 'placeholder must appear')
})

test('redact-extract: key-name pattern — "token" key is redacted', () => {
  const result = redactPayload({ token: 'supersecret' })
  assert.equal(result['token'], '[REDACTED]')
})

test('redact-extract: key-name pattern — "api_key" is redacted', () => {
  const result = redactPayload({ api_key: 'my-api-key-123' })
  assert.equal(result['api_key'], '[REDACTED]')
})

test('redact-extract: nested object is recursively redacted', () => {
  const result = redactPayload({ outer: { token: 'secret', safe: 'visible' } })
  const inner = (result['outer'] as Record<string, unknown>)
  assert.equal(inner['token'], '[REDACTED]')
  assert.equal(inner['safe'], 'visible')
})

test('redact-extract: already-redacted value is idempotent', () => {
  const result = redactPayload({ msg: '[REDACTED]' })
  assert.equal(result['msg'], '[REDACTED]')
})

test('redact-extract: non-sensitive keys pass through unchanged', () => {
  const result = redactPayload({ action: 'create', count: 42, ok: true })
  assert.equal(result['action'], 'create')
  assert.equal(result['count'], 42)
  assert.equal(result['ok'], true)
})
