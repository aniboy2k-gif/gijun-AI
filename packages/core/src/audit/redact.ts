// CSR #780 Phase 1: extracted from audit/service.ts (R2-C3 refactor).
//
// This module owns all sanitization logic so it can be imported by both
// the audit pipeline (service.ts) and the log sanitizer (lib/log-sanitizer.ts).
// External API is identical to what service.ts previously exported — zero
// surface change for existing callers.

// Value-pattern regexes: match common API-key and token formats.
// Scope (8 patterns): OpenAI · Anthropic · Bearer · GitHub PAT ·
//   AWS Access Key (AKIA/ASIA) · AWS Secret Key (keyword-context) ·
//   GCP private key (PEM block) · Azure Storage Account Key
// NOT covered (false-positive risk): standalone 40-char Base64, Stripe,
//   Slack bot token, JWT, PII — tracked in v0.2 roadmap.
export const REDACT_PATTERNS: readonly RegExp[] = Object.freeze([
  // ── existing 4 ──────────────────────────────────────────────────
  /sk-[A-Za-z0-9_-]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
  /ghp_[A-Za-z0-9]{36}/g,
  // ── AWS ─────────────────────────────────────────────────────────
  /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
  /(?:aws_?secret|secret_?access_?key)\s*[=:"'\s]+[A-Za-z0-9/+=]{40}/gi,
  // ── GCP ─────────────────────────────────────────────────────────
  /-----BEGIN(?:\s+[A-Z]+)?\s+PRIVATE KEY-----/gi,
  // ── Azure ───────────────────────────────────────────────────────
  /AccountKey=[A-Za-z0-9+/]{86}==/g,
])

export const REDACTED_PLACEHOLDER = '[REDACTED]'

// Key-name patterns: any payload key matching these is redacted regardless of
// value shape. Covers high-entropy secrets that value-pattern regex misses.
export const REDACT_KEY_PATTERN = /(^|_)(token|secret|password|api[_-]?key|authorization|cookie|session[_-]?id|refresh[_-]?token|access[_-]?token)$/i

export function redactString(s: string): string {
  let result = s
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, REDACTED_PLACEHOLDER)
  }
  return result
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEY_PATTERN.test(k) && (typeof v === 'string' || typeof v === 'number')) {
        out[k] = REDACTED_PLACEHOLDER
      } else {
        out[k] = redactValue(v)
      }
    }
    return out
  }
  return value
}

export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redactValue(payload) as Record<string, unknown>
}
