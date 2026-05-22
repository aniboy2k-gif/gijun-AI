// CSR #775 P6 H4: timingSafeEqual verification + regression guard
// Plan v2 reference: ~/workspace/gijun-ai/prompt_plan.md §P6
// Note: timing-safe comparison is already implemented in auth/token-holder.ts.
// This file documents the requirement and prevents regression.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isTokenValid, _resetForTests } from '../auth/token-holder.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// __dirname at runtime = dist-test/__tests__/ — go up two levels to package root, then src/
const TOKEN_HOLDER_PATH = resolve(
  __dirname,
  '../../src/auth/token-holder.ts',
)

// ---------------------------------------------------------------------------
// AST/grep regression guard — token-holder.ts must NOT use `===` for token compare
// ---------------------------------------------------------------------------

test('H4 regression guard: token-holder.ts imports timingSafeEqual', () => {
  const src = readFileSync(TOKEN_HOLDER_PATH, 'utf-8')
  assert.match(
    src,
    /import\s*\{[^}]*\btimingSafeEqual\b[^}]*\}\s*from\s*['"]node:crypto['"]/,
    'token-holder.ts must import timingSafeEqual from node:crypto',
  )
})

test('H4 regression guard: token-holder.ts uses timingSafeEqual (no naive ===)', () => {
  const src = readFileSync(TOKEN_HOLDER_PATH, 'utf-8')
  // Extract the safeCompare function body (between { and matching })
  const fnMatch = src.match(/function\s+safeCompare\b[\s\S]*?\n\}/)
  assert.ok(fnMatch, 'safeCompare function must exist')
  const body = fnMatch[0]
  // Must contain timingSafeEqual call
  assert.match(body, /timingSafeEqual\s*\(/, 'safeCompare must call timingSafeEqual')
  // Must NOT contain naive === comparison on the tokens themselves
  // (length comparison with === is OK and necessary)
  const tokenCompareEquals = body.match(/\b(provided|expected|currentToken|previousToken|a|b)\s*===\s*(provided|expected|currentToken|previousToken|a|b)/)
  assert.equal(
    tokenCompareEquals,
    null,
    'safeCompare must not use === to compare token contents',
  )
})

test('H4 regression guard: length mismatch path also calls timingSafeEqual (decoy)', () => {
  const src = readFileSync(TOKEN_HOLDER_PATH, 'utf-8')
  // Both the length-mismatch branch AND the invalid-input early return should
  // call timingSafeEqual with a dummy to maintain constant time.
  const dummyCalls = (src.match(/timingSafeEqual\s*\(\s*DUMMY/g) || []).length
  assert.ok(
    dummyCalls >= 2,
    `expected ≥2 timingSafeEqual(DUMMY,…) decoy calls, found ${dummyCalls}`,
  )
})

// ---------------------------------------------------------------------------
// Behavioral correctness — isTokenValid returns correct boolean
// ---------------------------------------------------------------------------

test('H4 isTokenValid: returns false for undefined/null/empty', () => {
  _resetForTests('correct-token')
  assert.equal(isTokenValid(undefined), false)
  assert.equal(isTokenValid(null), false)
  assert.equal(isTokenValid(''), false)
})

test('H4 isTokenValid: returns true for correct token', () => {
  _resetForTests('correct-token')
  assert.equal(isTokenValid('correct-token'), true)
})

test('H4 isTokenValid: returns false for wrong token (same length)', () => {
  _resetForTests('correct-token')
  assert.equal(isTokenValid('WRONGGG-token'), false) // same length, different content
})

test('H4 isTokenValid: returns false for wrong token (different length)', () => {
  _resetForTests('correct-token')
  assert.equal(isTokenValid('short'), false)
  assert.equal(isTokenValid('much-longer-than-correct-token'), false)
})

// ---------------------------------------------------------------------------
// Light statistical guard — coarse timing comparison (CI-flaky, informational)
// ---------------------------------------------------------------------------

test('H4 isTokenValid: statistical timing — same-length wrong vs correct close in mean', () => {
  _resetForTests('correct-token-32-chars-padding-x')
  const ITER = 5_000

  // Pre-warm V8
  for (let i = 0; i < 100; i++) {
    isTokenValid('correct-token-32-chars-padding-x')
    isTokenValid('WRONGGG-token-32-chars-padding-x')
  }

  const correctTimes: number[] = []
  const wrongTimes: number[] = []
  for (let i = 0; i < ITER; i++) {
    const t0 = process.hrtime.bigint()
    isTokenValid('correct-token-32-chars-padding-x')
    correctTimes.push(Number(process.hrtime.bigint() - t0))
  }
  for (let i = 0; i < ITER; i++) {
    const t0 = process.hrtime.bigint()
    isTokenValid('WRONGGG-token-32-chars-padding-x')
    wrongTimes.push(Number(process.hrtime.bigint() - t0))
  }
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
  const correctMean = mean(correctTimes)
  const wrongMean = mean(wrongTimes)
  // CI-tolerant: 5x ratio allowance (timingSafeEqual is constant-time at HW level
  // but JS overhead noise can cause variance). Strict ratio would be ~1.5x.
  const ratio = Math.max(correctMean, wrongMean) / Math.min(correctMean, wrongMean)
  // Informational — do not fail on tight ratio, but document the measurement.
  // Strict assertion below allows ratio up to 5x (very loose, CI-safe).
  assert.ok(
    ratio < 5,
    `same-length correct vs wrong timing ratio = ${ratio.toFixed(2)} (expected < 5x noise floor)`,
  )
})
