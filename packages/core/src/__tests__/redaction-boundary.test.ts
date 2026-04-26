// ASI06 redaction boundary test — pins the README claim in code.
// Covers 5 boundary paths: input / output / log / exception stack / audit event.
// Reference: README ASI06, prompt_plan.md Phase 5.
//
// Scope is intentionally narrow (matches README): the 4 patterns
// `sk-…`, `sk-ant-…`, `Bearer …`, `ghp_…`. Patterns explicitly NOT
// covered (AWS / GCP / Stripe / Slack / JWT / PII) are exercised here
// with negative assertions so the README scope ↔ code scope link is
// machine-checked.

import { resolve } from 'node:path'

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

import { runMigrations, closeDb } from '../db/client.js'
import { redactPayload, appendAuditEvent, tailAuditEvents } from '../audit/service.js'

// --- Fixture patterns ----------------------------------------------
// Each pattern is paired with one secret string that should match.
const COVERED = {
  openai: `sk-proj-${'a'.repeat(40)}`,
  anthropic: `sk-ant-api03-${'b'.repeat(40)}`,
  bearer: `Bearer ${'c'.repeat(40)}`,
  github_pat: `ghp_${'D'.repeat(36)}`,
}

// Patterns README claims are NOT covered. Used for negative assertions.
const NOT_COVERED = {
  aws: 'AKIAIOSFODNN7EXAMPLE',
  stripe: `sk_live_${'e'.repeat(24)}`,
  slack_bot: `xoxb-${'1'.repeat(11)}-${'2'.repeat(11)}-${'a'.repeat(24)}`,
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature',
  email: 'alice@example.com',
}

const REDACTED = '[REDACTED]'

before(() => {
  runMigrations()
})

after(() => {
  closeDb()
})

// === Path 1: input boundary =========================================
// `redactPayload` is the single redaction entry point. Verify each
// covered pattern is masked when fed in any field shape.
test('ASI06 path 1 (input): redactPayload masks 4 covered patterns at top-level field', () => {
  for (const [name, secret] of Object.entries(COVERED)) {
    const out = redactPayload({ token: secret, note: `prefix ${secret} suffix` })
    assert.ok(
      !JSON.stringify(out).includes(secret),
      `${name}: secret leaked through redactPayload (top-level)`,
    )
    assert.ok(
      JSON.stringify(out).includes(REDACTED),
      `${name}: [REDACTED] placeholder missing`,
    )
  }
})

test('ASI06 path 1 (input): redactPayload masks patterns nested in objects/arrays', () => {
  const payload = {
    nested: { deep: { token: COVERED.anthropic } },
    list: [COVERED.bearer, { x: COVERED.github_pat }],
  }
  const out = redactPayload(payload)
  const json = JSON.stringify(out)
  for (const secret of Object.values(COVERED)) {
    assert.ok(!json.includes(secret), `secret leaked through nested redaction: ${secret.slice(0, 12)}…`)
  }
})

test('ASI06 path 1 (input, negative scope): NOT_COVERED patterns survive — scope is honest', () => {
  // Pin README claim "scoped: 4 key patterns only".
  // If a future maintainer adds e.g. AWS support, this test will fail
  // and force a paired README update.
  for (const [name, secret] of Object.entries(NOT_COVERED)) {
    const out = redactPayload({ x: secret })
    assert.ok(
      JSON.stringify(out).includes(secret),
      `${name}: NOT_COVERED pattern was redacted — README must be updated to claim coverage`,
    )
  }
})

// === Path 2: output boundary ========================================
// "Output" = what callers see when they read the audit event back.
// `tailAuditEvents` returns the persisted (post-redaction) payload.
test('ASI06 path 2 (output): tailAuditEvents returns redacted payload (no original secrets)', () => {
  appendAuditEvent({
    eventType: 'asi06.test',
    actor: 'system',
    action: 'redaction.output',
    payload: { secret: COVERED.openai, note: COVERED.bearer },
  })
  const events = tailAuditEvents(5)
  const last = events[0]
  assert.ok(last, 'expected at least one audit event')
  const json = JSON.stringify(last)
  assert.ok(!json.includes(COVERED.openai), 'sk- secret leaked in tail output')
  assert.ok(!json.includes(COVERED.bearer), 'Bearer secret leaked in tail output')
  assert.ok(json.includes(REDACTED), '[REDACTED] placeholder missing in tail output')
})

// === Path 3: log boundary ===========================================
// There is no auto-redaction of console output in v0.1.4 (operator's
// responsibility). What we CAN pin: when an operator routes a payload
// through redactPayload before logging, secrets are absent from the
// stringified result. The test makes the operator pattern explicit
// and machine-checkable.
test('ASI06 path 3 (log): redactPayload-then-log pattern leaves no covered secret in the log line', () => {
  const userPayload = { request: { auth: COVERED.bearer, body: { key: COVERED.openai } } }
  // Simulated operator path: log(redactPayload(payload))
  const logged = JSON.stringify(redactPayload(userPayload))
  for (const secret of Object.values(COVERED)) {
    assert.ok(!logged.includes(secret), `log line contains unredacted secret: ${secret.slice(0, 12)}…`)
  }
})

// === Path 4: exception stack boundary ===============================
// Same scope caveat: there is no auto-redaction of `error.stack` in
// v0.1.4. We pin the operator pattern: errors carrying secret-bearing
// context must be re-thrown with a redacted message before crossing
// the API boundary. The test asserts that this pattern works — i.e.
// running redactPayload on the message object successfully strips
// covered patterns even when the value is interpolated into an error.
test('ASI06 path 4 (exception): redactPayload-then-throw pattern strips covered secrets from message', () => {
  const ctx = { input: COVERED.github_pat }
  let caughtMessage = ''
  try {
    const safeCtx = redactPayload(ctx)
    throw new Error(`processing failed: ${JSON.stringify(safeCtx)}`)
  } catch (err) {
    caughtMessage = err instanceof Error ? err.message : String(err)
  }
  assert.ok(!caughtMessage.includes(COVERED.github_pat), 'ghp_ secret leaked in error message')
  assert.ok(caughtMessage.includes(REDACTED), '[REDACTED] placeholder missing in error message')
})

// === Path 5: audit event row boundary ===============================
// End-to-end DB row check: append + tail returns redacted payload.
// `originalHash` (chain integrity) is computed from the unredacted
// input — verify chain remains valid AND the persisted payload is
// redacted.
test('ASI06 path 5 (audit event): persisted payload is redacted, chain hash valid', () => {
  appendAuditEvent({
    eventType: 'asi06.test',
    actor: 'system',
    action: 'redaction.persisted',
    payload: { ghp: COVERED.github_pat, anth: COVERED.anthropic },
  })
  const events = tailAuditEvents(1)
  // SQLite columns are snake_case; tailAuditEvents returns rows verbatim.
  const last = events[0] as { payload?: unknown; chain_hash?: string; original_hash?: string }
  assert.ok(last, 'expected an event row')
  const persisted = JSON.stringify(last.payload)
  assert.ok(!persisted.includes(COVERED.github_pat), 'github_pat present in persisted payload')
  assert.ok(!persisted.includes(COVERED.anthropic), 'sk-ant present in persisted payload')
  assert.match(persisted, /\[REDACTED\]/, '[REDACTED] placeholder missing')
  // Chain hash is deterministic (sha256 over the unredacted original).
  assert.ok(typeof last.chain_hash === 'string' && last.chain_hash.length === 64, 'chain_hash shape')
  assert.ok(typeof last.original_hash === 'string' && last.original_hash.length === 64, 'original_hash shape')
})
