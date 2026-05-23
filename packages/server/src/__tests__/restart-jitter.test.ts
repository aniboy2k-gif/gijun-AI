// CSR #777 Phase 2-b (R2-M4): restart-jitter helper test.
//
// `computeRestartDelay(baseMs, jitterPct)` is a pure helper. Tests cover:
//   - basic range (1000 ± 10% → all samples in [900, 1100])
//   - zero base clamps to 0
//   - negative base clamps to 0
//   - non-finite base clamps to 0
//   - zero jitter returns base exactly
//   - jitter clamps to [0, 100]
//   - distribution uniformity sanity (chi-square-like buckets)

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeRestartDelay } from '../lib/restart-jitter.js'

test('R2-M4 restart-jitter: 1000 ± 10% all samples in [900, 1100]', () => {
  for (let i = 0; i < 1000; i++) {
    const d = computeRestartDelay(1000, 10)
    assert.ok(d >= 900 && d <= 1100, `sample ${i}: ${d} out of [900, 1100]`)
  }
})

test('R2-M4 restart-jitter: baseMs=0 clamps to 0', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(computeRestartDelay(0, 10), 0)
  }
})

test('R2-M4 restart-jitter: negative baseMs clamps to 0', () => {
  assert.equal(computeRestartDelay(-1, 10), 0)
  assert.equal(computeRestartDelay(-1000, 50), 0)
})

test('R2-M4 restart-jitter: non-finite baseMs clamps to 0', () => {
  assert.equal(computeRestartDelay(Number.NaN, 10), 0)
  assert.equal(computeRestartDelay(Number.POSITIVE_INFINITY, 10), 0)
  assert.equal(computeRestartDelay(Number.NEGATIVE_INFINITY, 10), 0)
})

test('R2-M4 restart-jitter: zero jitter returns base exactly', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(computeRestartDelay(1234, 0), 1234)
  }
})

test('R2-M4 restart-jitter: jitterPct clamps to [0, 100]', () => {
  // Negative jitter clamps to 0 → base returned exactly.
  for (let i = 0; i < 20; i++) {
    assert.equal(computeRestartDelay(500, -10), 500)
  }
  // Over-100 clamps to 100 → samples in [0, 1000] (base ± 100%).
  for (let i = 0; i < 1000; i++) {
    const d = computeRestartDelay(500, 999)
    assert.ok(d >= 0 && d <= 1000, `sample ${i}: ${d} out of [0, 1000]`)
  }
})

test('R2-M4 restart-jitter: distribution covers full range (sanity)', () => {
  // 4 buckets across [900, 1100] — expect each bucket to receive non-zero hits.
  const buckets = [0, 0, 0, 0]
  const N = 2000
  for (let i = 0; i < N; i++) {
    const d = computeRestartDelay(1000, 10)
    const bucket = Math.min(3, Math.floor(((d - 900) / 200) * 4))
    if (bucket >= 0 && bucket <= 3) buckets[bucket] = (buckets[bucket] ?? 0) + 1
  }
  for (let i = 0; i < buckets.length; i++) {
    const count = buckets[i] ?? 0
    assert.ok(count > 0, `bucket ${i} got 0 hits out of ${N} samples — distribution suspect`)
  }
})

test('R2-M4 restart-jitter: small base with small range still returns base', () => {
  // base=5, jitter=10 → range = floor(5*10/100) = 0 → returns base exactly.
  for (let i = 0; i < 20; i++) {
    assert.equal(computeRestartDelay(5, 10), 5)
  }
})
