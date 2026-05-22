// RED skeleton for CSR #775 P7 H3: chattr/chflags append-only flag 신규
// Plan v2 reference: ~/workspace/gijun-ai/prompt_plan.md §P7
// Note: audit/append-only-flag.ts does not exist yet — RED at import time

import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

// Module under test
const mod = await import('../audit/append-only-flag.js')
const {
  applyAppendOnlyFlag,
  applyAppendOnlyFlagSafe,
  AppendOnlyFlagError,
  isSupported,
} = mod

const TMP_DIR = mkdtempSync(resolve(tmpdir(), 'gijun-h3-test-'))
process.on('exit', () => {
  try {
    rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

test('H3: isSupported returns true on darwin/linux, false elsewhere', () => {
  const result = isSupported()
  if (os.platform() === 'darwin' || os.platform() === 'linux') {
    assert.equal(result, true, `${os.platform()} must be supported`)
  } else {
    assert.equal(result, false)
  }
})

test('H3: AppendOnlyFlagError has correct shape', () => {
  const err = new AppendOnlyFlagError('test reason')
  assert.ok(err instanceof Error)
  assert.equal(err.name, 'AppendOnlyFlagError')
  assert.equal(err.reason, 'test reason')
  assert.match(err.message, /audit_append_only_flag_failed/)
})

test('H3: applyAppendOnlyFlag throws on non-existent path', () => {
  assert.throws(
    () => applyAppendOnlyFlag('/nonexistent/path/db.sqlite'),
    (err: unknown) => {
      assert.ok(err instanceof AppendOnlyFlagError)
      assert.match(
        (err as InstanceType<typeof AppendOnlyFlagError>).reason,
        /file not found|not.*exist|ENOENT/i,
      )
      return true
    },
  )
})

test('H3: applyAppendOnlyFlagSafe returns {applied:false, reason} on non-existent', () => {
  const result = applyAppendOnlyFlagSafe('/nonexistent/path/db.sqlite')
  assert.equal(result.applied, false)
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0)
})

test('H3: applyAppendOnlyFlagSafe returns {applied:true} on real file (best-effort)', () => {
  // macOS: chflags uappnd works at user level
  // Linux: chattr +a requires root or CAP_LINUX_IMMUTABLE — may fail in CI
  const dbPath = resolve(TMP_DIR, 'test-db.sqlite')
  writeFileSync(dbPath, 'fake db content')
  const result = applyAppendOnlyFlagSafe(dbPath)
  if (os.platform() === 'darwin') {
    assert.equal(result.applied, true, `chflags uappnd should succeed on macOS: ${result.reason ?? ''}`)
  } else if (os.platform() === 'linux') {
    // chattr +a may fail without root — accept both outcomes, but reason must be set on failure
    if (!result.applied) {
      assert.ok(result.reason, 'Linux failure must include reason')
    }
  } else {
    // unsupported platform
    assert.equal(result.applied, false)
  }
})

test('H3: applyAppendOnlyFlag throws on unsupported platform (mocked)', () => {
  // Cannot easily mock os.platform() — skip on supported platforms
  // This test documents the requirement; actual cross-platform test is integration-level
  if (!isSupported()) {
    assert.throws(() => applyAppendOnlyFlag('/tmp/whatever'), AppendOnlyFlagError)
  }
})
