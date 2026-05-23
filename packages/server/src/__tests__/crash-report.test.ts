// CSR #780 Phase 3: crash-report sanitizer tests.
//
// sanitizeCrashReport(content) applies full redaction to a crash report string.
// This is the core unit — installCrashSanitizer() registers it as an event handler
// and is tested at integration level (it modifies process event listeners, which
// is hard to isolate per-test without side effects on the full test runner).
//
// 3 tests:
//   1. Value-pattern (sk- token) in report body is redacted
//   2. Key-name pattern ("token" field) in JSON section is redacted
//   3. Already-redacted content is idempotent (no double-replace artefacts)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeCrashReport } from '../lib/crash-report.js'

test('crash-report: value-pattern — sk- token in report is redacted', () => {
  const report = JSON.stringify({
    header: { processId: 123, commandLine: ['node', 'server.js'] },
    environmentVariables: { AGENTGUARD_TOKEN: 'sk-abc123ABCDEF456789xyz012345', PATH: '/usr/bin' },
  })
  const sanitized = sanitizeCrashReport(report)
  assert.ok(!sanitized.includes('sk-abc123'), `raw token must not appear: ${sanitized.slice(0, 200)}`)
  assert.ok(sanitized.includes('[REDACTED]'), 'placeholder must appear')
  assert.ok(sanitized.includes('/usr/bin'), 'safe value must pass through')
})

test('crash-report: key-name pattern — "token" key value is redacted', () => {
  const report = JSON.stringify({
    header: {},
    userReport: { action: 'crash', token: 'supersecret_value_here', count: 1 },
  })
  const sanitized = sanitizeCrashReport(report)
  assert.ok(!sanitized.includes('supersecret_value_here'), 'raw secret must not appear')
  assert.ok(sanitized.includes('[REDACTED]'), 'placeholder must appear')
})

test('crash-report: idempotent — already-redacted content unchanged', () => {
  const report = JSON.stringify({ token: '[REDACTED]', msg: 'safe' })
  const sanitized = sanitizeCrashReport(report)
  assert.equal(sanitized, report, 'idempotent: already-redacted report must be unchanged')
})
