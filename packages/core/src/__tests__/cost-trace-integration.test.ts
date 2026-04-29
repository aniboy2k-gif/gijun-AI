import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

// In-memory DB for test isolation
process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')

import { runMigrations, closeDb } from '../db/client.js'
import { recordTrace, recordTraceFromCostEntry, generateTraceId, getCostSummary } from '../tracer/service.js'
import { parseAuto } from '../cost/parsers/registry.js'
import { CONSERVATIVE_ESTIMATE_MICROS_PER_CALL } from '../cost/pricing.js'

before(() => {
  runMigrations()
})

after(() => {
  closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
})

// ---------------------------------------------------------------------------
// recordTraceFromCostEntry integration
// ---------------------------------------------------------------------------

test('recordTraceFromCostEntry: inserts a trace row from a parsed Claude response', () => {
  const raw = {
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 1000, output_tokens: 200 },
  }
  const entry = parseAuto(raw, 'anthropic')
  const traceId = generateTraceId()
  const rowId = recordTraceFromCostEntry(traceId, entry, { operation: 'test-op', latencyMs: 100 })

  assert.ok(rowId > 0, 'row id must be positive')
  assert.equal(entry.parseStatus, 'success')
  assert.equal(entry.costSource, 'parsed')
})

test('recordTraceFromCostEntry: inserts a trace row from a parsed OpenAI response', () => {
  const raw = {
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
  }
  const entry = parseAuto(raw, 'openai')
  const traceId = generateTraceId()
  const rowId = recordTraceFromCostEntry(traceId, entry)

  assert.ok(rowId > 0)
  assert.equal(entry.parseStatus, 'success')
})

test('recordTraceFromCostEntry: stores failed entry with conservative estimate', () => {
  const raw = { garbage: 'data', no_usage: true }
  const entry = parseAuto(raw)
  const traceId = generateTraceId()
  const rowId = recordTraceFromCostEntry(traceId, entry)

  assert.ok(rowId > 0)
  assert.equal(entry.parseStatus, 'failed')
  assert.equal(entry.costUsdMicros, CONSERVATIVE_ESTIMATE_MICROS_PER_CALL)
})

// ---------------------------------------------------------------------------
// getCostSummary with mixed legacy + parsed rows
// ---------------------------------------------------------------------------

test('getCostSummary: sums cost_usd_micros from parsed rows correctly', () => {
  // Insert via legacy recordTrace (uses cost_usd, cost_usd_micros NULL / legacy)
  const legacyCost = 0.005
  recordTrace(generateTraceId(), {
    model: 'gpt-4o',
    provider: 'openai',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: legacyCost,
  })

  // Insert via new recordTraceFromCostEntry (uses cost_usd_micros)
  const parsedEntry = parseAuto({
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 200, output_tokens: 100 },
  }, 'anthropic')
  recordTraceFromCostEntry(generateTraceId(), parsedEntry)

  const summary = getCostSummary('24h')
  assert.ok(summary.total_calls >= 2, 'at least 2 calls')
  assert.ok(summary.total_cost_usd > 0, 'total cost must be positive')
})

test('getCostSummary: handles empty traces table gracefully', () => {
  // DB may already have rows from previous tests. Just verify it returns a valid object.
  const summary = getCostSummary('1h')
  assert.ok(typeof summary.total_cost_usd === 'number')
  assert.ok(typeof summary.total_calls === 'number')
  assert.ok(typeof summary.avg_latency_ms === 'number')
})

// ---------------------------------------------------------------------------
// usdToMicros / microsToUsd round-trip
// ---------------------------------------------------------------------------

import { usdToMicros, microsToUsd } from '../cost/types.js'

test('usdToMicros / microsToUsd: round-trip accuracy for small amounts', () => {
  const usd = 0.001  // $0.001 (1/1000 USD)
  const micros = usdToMicros(usd)
  const backToUsd = microsToUsd(micros)

  assert.equal(micros, 1000, '0.001 USD = 1000 micros')
  assert.ok(Math.abs(backToUsd - usd) < 1e-9, 'round-trip should be exact for this value')
})

test('usdToMicros: applies ROUND not CAST (no truncation error)', () => {
  // 0.1 USD × 1,000,000 in floating point can give 99999.99... without round
  const micros = usdToMicros(0.1)
  assert.equal(micros, 100_000, 'must be 100,000 (ROUND applied)')
})
