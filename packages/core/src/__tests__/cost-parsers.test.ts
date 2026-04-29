import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ClaudeParser, AnthropicPricingStrategy } from '../cost/parsers/claude.js'
import { OpenAIParser, OpenAIPricingStrategy } from '../cost/parsers/openai.js'
import { parseAuto, getParser } from '../cost/parsers/registry.js'
import { ANTHROPIC_PRICING, OPENAI_PRICING } from '../cost/pricing.js'
import { usdToMicros } from '../cost/types.js'

// ---------------------------------------------------------------------------
// ClaudeParser
// ---------------------------------------------------------------------------

test('ClaudeParser: parses a valid Anthropic API response', () => {
  const parser = new ClaudeParser()
  const raw = {
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 1000, output_tokens: 500 },
  }
  const entry = parser.parse(raw)

  assert.equal(entry.parseStatus, 'success')
  assert.equal(entry.costSource, 'parsed')
  assert.equal(entry.provider, 'anthropic')
  assert.equal(entry.model, 'claude-sonnet-4-6')
  assert.equal(entry.inputTokens, 1000)
  assert.equal(entry.outputTokens, 500)
  assert.ok(entry.costUsdMicros != null && entry.costUsdMicros > 0, 'cost must be positive')
  assert.ok(entry.rawPayloadHash?.startsWith('sha256:'), 'raw payload hash must be sha256: prefixed')
})

test('ClaudeParser: model in pricing table yields correct cost', () => {
  const parser = new ClaudeParser()
  const raw = {
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
  }
  const entry = parser.parse(raw)

  const pricing = ANTHROPIC_PRICING['claude-sonnet-4-6']
  assert.ok(pricing != null)
  const expectedMicros = usdToMicros(pricing.inputPerMillion + pricing.outputPerMillion)
  assert.equal(entry.costUsdMicros, expectedMicros)
  assert.equal(entry.parseStatus, 'success')
})

test('ClaudeParser: unknown model yields conservative estimation (failed)', () => {
  const parser = new ClaudeParser()
  const raw = {
    model: 'claude-unknown-future-model',
    usage: { input_tokens: 100, output_tokens: 50 },
  }
  const entry = parser.parse(raw)

  // Unknown model → pricing table miss → conservative estimation
  assert.equal(entry.parseStatus, 'failed')
  assert.equal(entry.costSource, 'estimated')
  assert.ok(entry.costUsdMicros != null && entry.costUsdMicros > 0)
})

test('ClaudeParser: missing usage field returns failed entry', () => {
  const parser = new ClaudeParser()
  const raw = { model: 'claude-sonnet-4-6' }
  const entry = parser.parse(raw)
  assert.equal(entry.parseStatus, 'failed')
  assert.ok(entry.parseError?.includes('usage'))
})

test('ClaudeParser: non-object input returns failed entry', () => {
  const parser = new ClaudeParser()
  const entry = parser.parse('not an object')
  assert.equal(entry.parseStatus, 'failed')
})

// ---------------------------------------------------------------------------
// OpenAIParser
// ---------------------------------------------------------------------------

test('OpenAIParser: parses a valid OpenAI API response', () => {
  const parser = new OpenAIParser()
  const raw = {
    model: 'gpt-4o',
    usage: { prompt_tokens: 2000, completion_tokens: 800, total_tokens: 2800 },
  }
  const entry = parser.parse(raw)

  assert.equal(entry.parseStatus, 'success')
  assert.equal(entry.costSource, 'parsed')
  assert.equal(entry.provider, 'openai')
  assert.equal(entry.model, 'gpt-4o')
  assert.equal(entry.inputTokens, 2000)
  assert.equal(entry.outputTokens, 800)
  assert.ok(entry.costUsdMicros != null && entry.costUsdMicros > 0)
})

test('OpenAIParser: model in pricing table yields correct cost', () => {
  const parser = new OpenAIParser()
  const raw = {
    model: 'gpt-4o',
    usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
  }
  const entry = parser.parse(raw)

  const pricing = OPENAI_PRICING['gpt-4o']
  assert.ok(pricing != null)
  const expectedMicros = usdToMicros(pricing.inputPerMillion + pricing.outputPerMillion)
  assert.equal(entry.costUsdMicros, expectedMicros)
})

test('OpenAIParser: unknown model yields conservative estimation (failed)', () => {
  const parser = new OpenAIParser()
  const raw = {
    model: 'gpt-5-turbo-future',
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  }
  const entry = parser.parse(raw)

  assert.equal(entry.parseStatus, 'failed')
  assert.equal(entry.costSource, 'estimated')
})

// ---------------------------------------------------------------------------
// Registry / parseAuto
// ---------------------------------------------------------------------------

test('registry: built-in parsers are auto-registered', () => {
  assert.ok(getParser('anthropic') != null, 'anthropic parser must be registered')
  assert.ok(getParser('openai') != null, 'openai parser must be registered')
})

test('parseAuto: detects Anthropic shape by usage.input_tokens', () => {
  const raw = {
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 500, output_tokens: 200 },
  }
  const entry = parseAuto(raw)
  assert.equal(entry.provider, 'anthropic')
  assert.equal(entry.parseStatus, 'success')
})

test('parseAuto: detects OpenAI shape by usage.prompt_tokens', () => {
  const raw = {
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 300, completion_tokens: 100, total_tokens: 400 },
  }
  const entry = parseAuto(raw)
  assert.equal(entry.provider, 'openai')
  assert.equal(entry.parseStatus, 'success')
})

test('parseAuto: providerHint overrides shape detection', () => {
  const raw = { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 50 } }
  const entry = parseAuto(raw, 'anthropic')
  assert.equal(entry.provider, 'anthropic')
})

test('parseAuto: unrecognised shape with no hint returns failed entry with conservative estimate', () => {
  const raw = { some: 'unknown format' }
  const entry = parseAuto(raw)
  assert.equal(entry.parseStatus, 'failed')
  assert.equal(entry.costSource, 'estimated')
  assert.ok(entry.costUsdMicros != null && entry.costUsdMicros > 0, 'conservative estimate must be positive')
})

// ---------------------------------------------------------------------------
// Pricing strategies
// ---------------------------------------------------------------------------

test('AnthropicPricingStrategy: returns estimated cost for unknown model', () => {
  const strategy = new AnthropicPricingStrategy()
  const result = strategy.estimateCost({ model: 'unknown-model', inputTokens: null, outputTokens: null })
  assert.equal(result.source, 'estimated')
  assert.ok(result.micros > 0)
})

test('OpenAIPricingStrategy: returns parsed cost for known model with token counts', () => {
  const strategy = new OpenAIPricingStrategy()
  const result = strategy.estimateCost({ model: 'gpt-4o', inputTokens: 1000, outputTokens: 500 })
  assert.equal(result.source, 'parsed')
  assert.ok(result.micros > 0)
})
