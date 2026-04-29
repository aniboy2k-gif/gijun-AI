import type { ICostParser } from './types.js'
import type { CostEntry } from '../types.js'
import { ClaudeParser } from './claude.js'
import { OpenAIParser } from './openai.js'
import { CONSERVATIVE_ESTIMATE_MICROS_PER_CALL } from '../pricing.js'

const _parsers = new Map<string, ICostParser>()

/** Register a parser for a provider. Overwrites any existing registration. */
export function registerParser(parser: ICostParser): void {
  _parsers.set(parser.provider, parser)
}

/** Returns the registered parser for the given provider, or undefined. */
export function getParser(provider: string): ICostParser | undefined {
  return _parsers.get(provider)
}

/**
 * Parses a raw AI provider response into a CostEntry.
 *
 * Provider selection order:
 *  1. providerHint if given and a matching parser is registered
 *  2. Detect 'anthropic' or 'openai' from well-known response shape heuristics
 *  3. Fallback: returns a failed entry with conservative cost estimate
 */
export function parseAuto(rawResponse: unknown, providerHint?: string): CostEntry {
  // 1. Explicit hint
  if (providerHint) {
    const parser = _parsers.get(providerHint)
    if (parser) return parser.parse(rawResponse)
  }

  // 2. Shape-based detection
  if (isAnthropicShape(rawResponse)) {
    const parser = _parsers.get('anthropic')
    if (parser) return parser.parse(rawResponse)
  }
  if (isOpenAiShape(rawResponse)) {
    const parser = _parsers.get('openai')
    if (parser) return parser.parse(rawResponse)
  }

  // 3. Fallback
  return {
    provider: providerHint ?? 'unknown',
    model: 'unknown',
    unit: 'token',
    inputTokens: null,
    outputTokens: null,
    costUsdMicros: CONSERVATIVE_ESTIMATE_MICROS_PER_CALL,
    parseStatus: 'failed',
    costSource: 'estimated',
    parseError: 'no matching parser found for provider',
    timestamp: new Date().toISOString(),
  }
}

function isAnthropicShape(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  // Anthropic responses have usage.input_tokens
  const usage = obj['usage']
  return typeof usage === 'object' && usage !== null && 'input_tokens' in usage
}

function isOpenAiShape(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  // OpenAI responses have usage.prompt_tokens
  const usage = obj['usage']
  return typeof usage === 'object' && usage !== null && 'prompt_tokens' in usage
}

// Auto-register built-in parsers on module load.
registerParser(new ClaudeParser())
registerParser(new OpenAIParser())
