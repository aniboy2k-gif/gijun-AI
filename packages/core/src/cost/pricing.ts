/**
 * Model pricing tables.
 *
 * Prices are in USD per 1,000,000 tokens (per-million pricing).
 * Source: provider pricing pages as of 2026-04.
 * When a model is not in the table, parsers set parseStatus='failed' and
 * IPricingStrategy falls back to CONSERVATIVE_ESTIMATE_MICROS_PER_CALL.
 *
 * To update: change the values here and rebuild. A future improvement
 * (v0.3+) may load prices from an external config file without rebuild.
 */

export type TokenPricing = {
  /** USD per 1M input tokens */
  inputPerMillion: number
  /** USD per 1M output tokens */
  outputPerMillion: number
}

/** Anthropic model pricing table (USD / 1M tokens). */
export const ANTHROPIC_PRICING: Record<string, TokenPricing> = {
  // Claude 4.x
  'claude-opus-4-7':           { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  'claude-sonnet-4-6':         { inputPerMillion:  3.00, outputPerMillion: 15.00 },
  'claude-haiku-4-5-20251001': { inputPerMillion:  0.80, outputPerMillion:  4.00 },
  // Claude 3.x (still in use)
  'claude-3-5-sonnet-20241022': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-3-5-haiku-20241022':  { inputPerMillion: 0.80, outputPerMillion:  4.00 },
  'claude-3-opus-20240229':     { inputPerMillion: 15.00, outputPerMillion: 75.00 },
}

/** OpenAI model pricing table (USD / 1M tokens). */
export const OPENAI_PRICING: Record<string, TokenPricing> = {
  'gpt-4o':              { inputPerMillion:  2.50, outputPerMillion: 10.00 },
  'gpt-4o-mini':         { inputPerMillion:  0.15, outputPerMillion:  0.60 },
  'gpt-4-turbo':         { inputPerMillion: 10.00, outputPerMillion: 30.00 },
  'gpt-4':               { inputPerMillion: 30.00, outputPerMillion: 60.00 },
  'gpt-3.5-turbo':       { inputPerMillion:  0.50, outputPerMillion:  1.50 },
  'o1':                  { inputPerMillion: 15.00, outputPerMillion: 60.00 },
  'o1-mini':             { inputPerMillion:  3.00, outputPerMillion: 12.00 },
}

/**
 * Conservative per-call cost estimate in micros used when:
 * - parseStatus='failed' (raw response unparseable)
 * - model not in any pricing table
 *
 * Set to the highest realistic per-call cost to avoid silent budget overruns.
 * Equivalent to 1 M input + 200 K output at Opus-4 pricing ≈ $15 + $15 = $30 max.
 * Using $0.10 default as a practical baseline for single API calls.
 */
export const CONSERVATIVE_ESTIMATE_MICROS_PER_CALL = usdToMicros(0.10)

function usdToMicros(usd: number): number {
  return Math.round(usd * 1_000_000)
}

/** Compute cost in micros given a pricing entry and token counts. */
export function computeCostMicros(
  pricing: TokenPricing,
  inputTokens: number,
  outputTokens: number,
): number {
  const inputCost = (pricing.inputPerMillion / 1_000_000) * inputTokens
  const outputCost = (pricing.outputPerMillion / 1_000_000) * outputTokens
  return Math.round((inputCost + outputCost) * 1_000_000)
}
