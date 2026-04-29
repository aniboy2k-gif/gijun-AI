import { z } from 'zod'

/**
 * Outcome of a cost-parsing attempt for a single AI API call.
 *
 * - 'success'  — token counts and model price resolved; cost_usd_micros is accurate.
 * - 'failed'   — raw response could not be parsed; cost_usd_micros holds a conservative
 *                estimation from IPricingStrategy.estimateCost() so the budget gate
 *                remains conservative rather than silent.
 * - 'legacy'   — pre-migration row written by recordTrace(); no parsing attempted.
 */
export type ParseStatus = 'success' | 'failed' | 'legacy'

/**
 * Cost source provenance — tracks how cost_usd_micros was determined.
 */
export type CostSource = 'parsed' | 'estimated' | 'legacy'

/**
 * Normalised cost entry produced by an ICostParser.
 * cost_usd_micros is the canonical field; cost_usd (REAL column) is deprecated.
 */
export const CostEntrySchema = z.object({
  /** Provider identifier, e.g. 'anthropic' or 'openai'. */
  provider: z.string().min(1),
  /** Model identifier as returned by the provider, e.g. 'claude-sonnet-4-6'. */
  model: z.string().min(1),
  /** Billing unit — well-known values: 'token', 'call', 'character'. Open string. */
  unit: z.string().default('token'),
  /** Prompt / input token count. Null if parsing failed for this field. */
  inputTokens: z.number().int().nonnegative().nullable(),
  /** Completion / output token count. Null if parsing failed for this field. */
  outputTokens: z.number().int().nonnegative().nullable(),
  /**
   * Cost in integer micros (1 USD = 1,000,000 micros).
   * Null only when parse_status='failed' AND no estimation is available.
   * Conservative estimate is used for 'failed' entries via IPricingStrategy.
   */
  costUsdMicros: z.number().int().nullable(),
  parseStatus: z.enum(['success', 'failed', 'legacy']),
  costSource: z.enum(['parsed', 'estimated', 'legacy']),
  /**
   * Human-readable parse error. Only present when parseStatus='failed'.
   * Do not store raw provider error messages that might contain PII.
   */
  parseError: z.string().optional(),
  /**
   * sha256 fingerprint of the raw provider response BEFORE redaction.
   * Format: "sha256:<64-hex>". Stored for audit reproducibility.
   * The full payload is never stored here.
   */
  rawPayloadHash: z.string().optional(),
  /** ISO 8601 UTC timestamp. Defaults to the parsing instant if not in the raw response. */
  timestamp: z.string().datetime().optional(),
})

export type CostEntry = z.infer<typeof CostEntrySchema>

/** Convenience: USD float from integer micros. Uses Math.round for integer input safety. */
export function microsToUsd(micros: number): number {
  return micros / 1_000_000
}

/** Converts a USD float to integer micros, applying Math.round to avoid truncation errors. */
export function usdToMicros(usd: number): number {
  return Math.round(usd * 1_000_000)
}
