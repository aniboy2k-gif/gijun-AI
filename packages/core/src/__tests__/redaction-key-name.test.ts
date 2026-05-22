// Key-name redaction test — covers high-entropy secrets that value-pattern
// regex misses (e.g., lowercase hex AGENTGUARD_TOKEN).
// Reference: CSR #758 C2 (audit redaction misconception).

import { resolve } from 'node:path'

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { redactPayload } from '../audit/service.js'

const HEX_TOKEN = 'ffdf8d75cad60a96a7d810162f3087dc'

test('redactPayload: key "token" with hex value is redacted', () => {
  const out = redactPayload({ token: HEX_TOKEN }) as { token: unknown }
  assert.equal(out.token, '[REDACTED]')
})

test('redactPayload: key "old_token" / "new_token" are redacted', () => {
  const out = redactPayload({ old_token: HEX_TOKEN, new_token: HEX_TOKEN }) as Record<string, unknown>
  assert.equal(out.old_token, '[REDACTED]')
  assert.equal(out.new_token, '[REDACTED]')
})

test('redactPayload: nested key "secret" is redacted', () => {
  const out = redactPayload({ nested: { api_secret: HEX_TOKEN } }) as { nested: { api_secret: unknown } }
  assert.equal(out.nested.api_secret, '[REDACTED]')
})

test('redactPayload: key "password" is redacted regardless of value shape', () => {
  const out = redactPayload({ password: 'plaintext' }) as { password: unknown }
  assert.equal(out.password, '[REDACTED]')
})

test('redactPayload: key "api_key" / "api-key" / "apikey" all redacted', () => {
  const a = redactPayload({ api_key: 'x' }) as Record<string, unknown>
  const b = redactPayload({ 'api-key': 'x' }) as Record<string, unknown>
  const c = redactPayload({ apikey: 'x' }) as Record<string, unknown>
  assert.equal(a.api_key, '[REDACTED]')
  assert.equal(b['api-key'], '[REDACTED]')
  assert.equal(c.apikey, '[REDACTED]')
})

test('redactPayload: key "authorization" is redacted', () => {
  const out = redactPayload({ authorization: 'Bearer xyz' }) as { authorization: unknown }
  assert.equal(out.authorization, '[REDACTED]')
})

test('redactPayload: non-secret keys preserved', () => {
  const out = redactPayload({ id: 42, name: 'foo', count: 7 }) as Record<string, unknown>
  assert.equal(out.id, 42)
  assert.equal(out.name, 'foo')
  assert.equal(out.count, 7)
})

test('redactPayload: key "token_count" NOT redacted (suffix-only match)', () => {
  // REDACT_KEY_PATTERN requires the key to END with token/secret/etc.,
  // so "token_count" (token used as prefix) is preserved as numeric metadata.
  const out = redactPayload({ token_count: 42 }) as { token_count: unknown }
  assert.equal(out.token_count, 42)
})

test('redactPayload: key "refresh_token" / "access_token" redacted', () => {
  const out = redactPayload({
    refresh_token: 'rt-' + HEX_TOKEN,
    access_token: 'at-' + HEX_TOKEN,
  }) as Record<string, unknown>
  assert.equal(out.refresh_token, '[REDACTED]')
  assert.equal(out.access_token, '[REDACTED]')
})

// CSR #775 H-INT-2: AGENTGUARD_CONFIG_HMAC_KEY parity with other secrets
test('redactPayload: key "hmac_key" / "agentguard_config_hmac_key" / "config_hmac_key" redacted', () => {
  const out = redactPayload({
    hmac_key: HEX_TOKEN,
    agentguard_config_hmac_key: HEX_TOKEN,
    config_hmac_key: HEX_TOKEN,
  }) as Record<string, unknown>
  assert.equal(out.hmac_key, '[REDACTED]')
  assert.equal(out.agentguard_config_hmac_key, '[REDACTED]')
  assert.equal(out.config_hmac_key, '[REDACTED]')
})

test('redactPayload: nested hmac-key variants redacted', () => {
  const out = redactPayload({
    auth: { hmac_key: HEX_TOKEN, 'hmac-key': HEX_TOKEN },
  }) as { auth: Record<string, unknown> }
  assert.equal(out.auth['hmac_key'], '[REDACTED]')
  assert.equal(out.auth['hmac-key'], '[REDACTED]')
})
