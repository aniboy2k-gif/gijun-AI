// CSR #780 Phase 2: log output sanitizer.
//
// installLogSanitizer() wraps console.log/warn/error so that any argument
// is passed through redactValue() before the native method writes output.
// This closes the gap between audit_events (already sanitized) and raw console.
//
// Design:
//   - module-level `installed` flag for idempotent install and test reset.
//   - Raw method references captured at install time — wrapper calls them
//     directly, never `console.log`, so no recursion path exists.
//   - try/catch: if redactValue throws, original args forwarded (fail-safe).
//   - Opt-out: resolveLogSanitizeEnabled() checks AGENTGUARD_LOG_SANITIZE env.
//   - stderr direct writes (process.stdout.write, native bindings) NOT covered
//     — documented limit; winston/pino migration is a future carry-forward item.

import { redactValue } from '../audit/redact.js'

let installed = false

/**
 * Returns true when log sanitization is enabled (default).
 * Set env AGENTGUARD_LOG_SANITIZE=0 to opt out (Tier-B graceful-degrade).
 */
export function resolveLogSanitizeEnabled(envValue: string | undefined): boolean {
  return envValue !== '0'
}

function sanitizeArgs(args: unknown[]): unknown[] {
  try {
    return args.map((arg) => redactValue(arg))
  } catch {
    return args
  }
}

/**
 * Install sanitizing wrappers on console.log/warn/error.
 * Idempotent: subsequent calls are no-ops (module-level flag).
 */
export function installLogSanitizer(): void {
  if (installed) return

  const rawLog = console.log.bind(console)
  const rawWarn = console.warn.bind(console)
  const rawError = console.error.bind(console)

  console.log = (...args: unknown[]) => rawLog(...sanitizeArgs(args))
  console.warn = (...args: unknown[]) => rawWarn(...sanitizeArgs(args))
  console.error = (...args: unknown[]) => rawError(...sanitizeArgs(args))

  installed = true
}

/**
 * Reset install flag (test-only). Do NOT call in production code.
 */
export function _resetForTests(): void {
  installed = false
}
