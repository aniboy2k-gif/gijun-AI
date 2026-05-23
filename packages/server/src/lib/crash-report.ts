// CSR #780 Phase 3: crash-report sanitizer.
//
// installCrashSanitizer() registers process event handlers for uncaughtException
// and unhandledRejection. When triggered, it sanitizes any diagnostic report
// that process.report.writeReport() produced, replacing known sensitive patterns
// with [REDACTED] before the report is retained on disk.
//
// sanitizeCrashReport(content) is exported for unit testing and can be used by
// external tooling (e.g., a CI artifact scanner) independently.
//
// Limits:
//   - Only covers process.report.writeReport() path. The --diagnostic-report-on-
//     uncaught-exception Node.js flag generates a report *before* this handler
//     runs. See docs/credential-sanitization-guide.md for the recommended
//     approach (disable the flag; rely on this handler instead).
//   - File I/O is synchronous to avoid event-loop re-entry issues at crash time.
//   - opt-out: AGENTGUARD_CRASH_REPORT_SANITIZE=0

import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { redactString, redactValue } from '@gijun-ai/core'

let installed = false

/**
 * Apply value-pattern and key-name redaction to a crash-report string.
 * Attempts JSON parse+sanitize (covers key-name patterns); falls back to
 * string-level redaction (covers value-pattern regex) if parse fails.
 * Idempotent — calling twice produces the same result.
 */
export function sanitizeCrashReport(content: string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    return JSON.stringify(redactValue(parsed) as Record<string, unknown>)
  } catch {
    return redactString(content)
  }
}

function sanitizeFile(reportPath: string): void {
  try {
    const raw = readFileSync(reportPath, 'utf8')
    const sanitized = sanitizeCrashReport(raw)
    if (sanitized === raw) return
    const tmpPath = join(dirname(reportPath), `.agentguard-redact-${randomBytes(8).toString('hex')}.tmp`)
    writeFileSync(tmpPath, sanitized, 'utf8')
    renameSync(tmpPath, reportPath)
  } catch {
    // Best-effort: never throw inside an uncaught-exception handler.
  }
}

/**
 * Register crash-report sanitization handlers.
 * Idempotent — subsequent calls are no-ops.
 * Set AGENTGUARD_CRASH_REPORT_SANITIZE=0 to opt out (Tier-B graceful-degrade).
 */
export function installCrashSanitizer(): void {
  if (installed) return
  if (process.env['AGENTGUARD_CRASH_REPORT_SANITIZE'] === '0') {
    console.warn(
      '[agentguard] WARNING: crash-report sanitization is DISABLED ' +
      '(AGENTGUARD_CRASH_REPORT_SANITIZE=0). Diagnostic reports are NOT sanitized.',
    )
    return
  }

  process.on('uncaughtException', (_err: unknown) => {
    const reportPath = process.report.writeReport()
    if (reportPath) sanitizeFile(reportPath)
    process.exit(1)
  })

  process.on('unhandledRejection', (_reason: unknown) => {
    // Node.js v15+ fatal: registering any unhandledRejection listener suppresses
    // the default exit. We must exit explicitly to maintain fail-close semantics.
    const reportPath = process.report.writeReport()
    if (reportPath) sanitizeFile(reportPath)
    process.exit(1)
  })

  installed = true
}

/** Reset install flag (test-only). Do NOT call in production. */
export function _resetForTests(): void {
  installed = false
}
