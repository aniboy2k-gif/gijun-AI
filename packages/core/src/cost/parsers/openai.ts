import { createHash } from 'node:crypto'
import type { ICostParser, IPricingStrategy } from './types.js'
import type { CostEntry } from '../types.js'
import {
  OPENAI_PRICING,
  CONSERVATIVE_ESTIMATE_MICROS_PER_CALL,
  computeCostMicros,
} from '../pricing.js'

/** Pricing strategy for OpenAI models. */
export class OpenAIPricingStrategy implements IPricingStrategy {
  readonly provider = 'openai'

  estimateCost(usage: { model: string; inputTokens: number | null; outputTokens: number | null }) {
    const pricing = OPENAI_PRICING[usage.model]
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
 * Parses an OpenAI API response into a CostEntry.
 *
 * Expected input shape (OpenAI Chat Completions API):
 * {
 *   model: string,
 *   usage: { prompt_tokens: number, completion_tokens: number, total_tokens: number },
 *   ...
 * }
 */
export class OpenAIParser implements ICostParser {
  readonly provider = 'openai'
  private readonly pricing = new OpenAIPricingStrategy()

  parse(rawResponse: unknown): CostEntry {
    const timestamp = new Date().toISOString()
    const rawPayloadHash = hashPayload(rawResponse)

    if (!isObject(rawResponse)) {
      return makeFailedEntry('openai', 'unknown', 'raw response is not an object', rawPayloadHash, timestamp, this.pricing)
    }

    const model = typeof rawResponse['model'] === 'string' ? rawResponse['model'] : null
    if (!model) {
      return makeFailedEntry('openai', 'unknown', 'missing model field', rawPayloadHash, timestamp, this.pricing)
    }

    const usage = rawResponse['usage']
    if (!isObject(usage)) {
      return makeFailedEntry('openai', model, 'missing usage field', rawPayloadHash, timestamp, this.pricing)
    }

    // OpenAI uses prompt_tokens / completion_tokens
    const inputTokens = typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : null
    const outputTokens = typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] : null

    if (inputTokens == null || outputTokens == null) {
      return makeFailedEntry('openai', model, 'missing token counts in usage', rawPayloadHash, timestamp, this.pricing)
    }

    const { micros, source } = this.pricing.estimateCost({ model, inputTokens, outputTokens })

    // parseStatus='success' only when pricing resolved from the table (source='parsed').
    // If the model is not in the pricing table, source='estimated' → parseStatus='failed'.
    if (source === 'estimated') {
      return makeFailedEntry('openai', model, `model '${model}' not found in pricing table; conservative estimate applied`, rawPayloadHash, timestamp, this.pricing)
    }

    return {
      provider: 'openai',
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
