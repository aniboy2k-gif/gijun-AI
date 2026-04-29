import type { CostEntry } from '../types.js'

/**
 * Parses a raw AI provider API response into a normalised CostEntry.
 * Implementations must NOT throw — return CostEntry with parseStatus='failed' instead.
 */
export interface ICostParser {
  /** Provider identifier this parser handles, e.g. 'anthropic'. */
  readonly provider: string
  /** Parse a raw response object into a CostEntry. */
  parse(rawResponse: unknown): CostEntry
}

/**
 * Estimates the cost of an AI call when exact pricing is unavailable.
 * Separated from ICostParser (SRP): parsers handle token extraction,
 * pricing strategies handle cost calculation.
 */
export interface IPricingStrategy {
  /** Provider identifier this strategy covers. */
  readonly provider: string
  /**
   * Returns cost in micros (1 USD = 1,000,000) and its source.
   * Always returns a value — falls back to conservative estimate if model unknown.
   */
  estimateCost(usage: { model: string; inputTokens: number | null; outputTokens: number | null }): {
    micros: number
    source: 'parsed' | 'estimated'
  }
}
