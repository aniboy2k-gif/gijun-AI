import { createHash } from 'node:crypto'
import type { ICostParser, IPricingStrategy } from './types.js'
import type { CostEntry } from '../types.js'
import {
  ANTHROPIC_PRICING,
  CONSERVATIVE_ESTIMATE_MICROS_PER_CALL,
  computeCostMicros,
} from '../pricing.js'

/** Pricing strategy for Anthropic models. */
export class AnthropicPricingStrategy implements IPricingStrategy {
  readonly provider = 'anthropic'

  estimateCost(usage: { model: string; inputTokens: number | null; outputTokens: number | null }) {
    const pricing = ANTHROPIC_PRICING[usage.model]
    if (!pricing || usage.inputTokens == null || usage.outputTokens == null) {
      return { micros: CONSERVATIVE_ESTIMATE_MICROS_PER_CALL, source: 'estimated' as const }
    }
    return {
      micros: computeCostMicros(pricing, usage.inputTokens, usage.outputTokens),
      source: 'parsed' as const,
    }
  }
}

/**
 * Parses an Anthropic API response into a CostEntry.
 *
 * Expected input shape (Claude Messages API):
 * {
 *   model: string,
 *   usage: { input_tokens: number, output_tokens: number },
 *   ...
 * }
 */
export class ClaudeParser implements ICostParser {
  readonly provider = 'anthropic'
  private readonly pricing = new AnthropicPricingStrategy()

  parse(rawResponse: unknown): CostEntry {
    const timestamp = new Date().toISOString()
    const rawPayloadHash = hashPayload(rawResponse)

    if (!isObject(rawResponse)) {
      return makeFailedEntry('anthropic', 'unknown', 'raw response is not an object', rawPayloadHash, timestamp, this.pricing)
    }

    const model = typeof rawResponse['model'] === 'string' ? rawResponse['model'] : null
    if (!model) {
      return makeFailedEntry('anthropic', 'unknown', 'missing model field', rawPayloadHash, timestamp, this.pricing)
    }

    const usage = rawResponse['usage']
    if (!isObject(usage)) {
      return makeFailedEntry('anthropic', model, 'missing usage field', rawPayloadHash, timestamp, this.pricing)
    }

    const inputTokens = typeof usage['input_tokens'] === 'number' ? usage['input_tokens'] : null
    const outputTokens = typeof usage['output_tokens'] === 'number' ? usage['output_tokens'] : null

    if (inputTokens == null || outputTokens == null) {
      return makeFailedEntry('anthropic', model, 'missing token counts in usage', rawPayloadHash, timestamp, this.pricing)
    }

    const { micros, source } = this.pricing.estimateCost({ model, inputTokens, outputTokens })

    // parseStatus='success' only when pricing resolved from the table (source='parsed').
    // If the model is not in the pricing table, source='estimated' → parseStatus='failed'.
    if (source === 'estimated') {
      return makeFailedEntry('anthropic', model, `model '${model}' not found in pricing table; conservative estimate applied`, rawPayloadHash, timestamp, this.pricing)
    }

    return {
      provider: 'anthropic',
      model,
      unit: 'token',
      inputTokens,
      outputTokens,
      costUsdMicros: micros,
      parseStatus: 'success',
      costSource: source,
      rawPayloadHash,
      timestamp,
    }
  }
}

function makeFailedEntry(
  provider: string,
  model: string,
  error: string,
  rawPayloadHash: string,
  timestamp: string,
  pricing: IPricingStrategy,
): CostEntry {
  const estimated = pricing.estimateCost({ model, inputTokens: null, outputTokens: null })
  return {
    provider,
    model,
    unit: 'token',
    inputTokens: null,
    outputTokens: null,
    costUsdMicros: estimated.micros,
    parseStatus: 'failed',
    costSource: 'estimated',
    parseError: error,
    rawPayloadHash,
    timestamp,
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function hashPayload(v: unknown): string {
  const json = JSON.stringify(v) ?? 'null'
  return 'sha256:' + createHash('sha256').update(json).digest('hex')
}
