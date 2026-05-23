// CSR #780 Phase 2: log sanitizer tests.
//
// Test order: capture spy FIRST (raw), then install sanitizer ON TOP.
// Calling console.log(...) → sanitizer wraps → passes redacted args → spy captures.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { installLogSanitizer, resolveLogSanitizeEnabled, _resetForTests } from '../lib/log-sanitizer.js'

const origLog = console.log
const origWarn = console.warn
const origError = console.error

function restore(): void {
  console.log = origLog
  console.warn = origWarn
  console.error = origError
}

after(restore)

// Helper: set up a spy as the raw target, then install sanitizer on top.
// Returns the array that will hold captured args.
function setupSpy(): unknown[][] {
  restore()
  _resetForTests()
  const captured: unknown[][] = []
  // Spy sits at the raw level — sanitizer will call it with redacted args
  console.log = (...args: unknown[]) => { captured.push(['log', ...args]) }
  console.warn = (...args: unknown[]) => { captured.push(['warn', ...args]) }
  console.error = (...args: unknown[]) => { captured.push(['error', ...args]) }
  installLogSanitizer()
  return captured
}

test('log-sanitizer: value-pattern — sk- token in string is redacted', () => {
  const captured = setupSpy()
  console.log('token=sk-abc123ABCDEF456789xyz012345')
  const outputStr = JSON.stringify(captured)
  assert.ok(!outputStr.includes('sk-abc123'), `raw token must not appear: ${outputStr}`)
  assert.ok(outputStr.includes('[REDACTED]'), 'placeholder must appear')
  restore()
})

test('log-sanitizer: object key-name — "token" key is redacted', () => {
  const captured = setupSpy()
  console.log({ token: 'supersecret123', action: 'login' })
  const outputStr = JSON.stringify(captured)
  assert.ok(!outputStr.includes('supersecret123'), `raw value must not appear: ${outputStr}`)
  assert.ok(outputStr.includes('[REDACTED]'), 'placeholder must appear')
  assert.ok(outputStr.includes('login'), 'safe key must pass through')
  restore()
})

test('log-sanitizer: idempotent — double install does not break wrapping', () => {
  const captured = setupSpy()
  // First install happened in setupSpy; a second call must be a no-op
  installLogSanitizer()
  console.log('secret=sk-abc123ABCDEF456789xyz01234567890abc')
  const outputStr = JSON.stringify(captured)
  assert.ok(outputStr.includes('[REDACTED]'), 'sanitizer must still work after double-install')
  restore()
})

test('log-sanitizer: resolveLogSanitizeEnabled — env parsing', () => {
  assert.equal(resolveLogSanitizeEnabled('0'), false, 'env=0 opts out')
  assert.equal(resolveLogSanitizeEnabled(undefined), true, 'default is enabled')
  assert.equal(resolveLogSanitizeEnabled('1'), true, 'env=1 is enabled')
  assert.equal(resolveLogSanitizeEnabled('false'), true, 'only "0" opts out')
})

test('log-sanitizer: no crash on deeply nested object', () => {
  const captured = setupSpy()
  const nested = { a: { b: { token: 'mysecret', c: 'safe' } } }
  assert.doesNotThrow(() => console.log(nested))
  const outputStr = JSON.stringify(captured)
  assert.ok(outputStr.includes('[REDACTED]'), 'nested token must be redacted')
  assert.ok(outputStr.includes('safe'), 'safe nested key must pass through')
  restore()
})
