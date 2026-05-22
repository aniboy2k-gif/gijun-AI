// CSR #775 P7 H3: chattr/chflags append-only flag 신규
// Refs: CSR #771 R4 DeepSeek H1 — chattr silent failure → audit log tampering
// Plan v2: ~/workspace/gijun-ai/prompt_plan.md §P7
//
// Purpose: audit DB 파일에 OS append-only flag 적용. tamper detection (hash chain)에
// 추가하여 prevention layer 제공. production에서 실패 시 boot abort.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'

export class AppendOnlyFlagError extends Error {
  constructor(public reason: string) {
    super(`audit_append_only_flag_failed: ${reason}`)
    this.name = 'AppendOnlyFlagError'
  }
}

export function isSupported(): boolean {
  const platform = os.platform()
  return platform === 'darwin' || platform === 'linux'
}

/**
 * Apply OS-level append-only flag to a file.
 * - macOS: chflags uappnd (user-level, no sudo)
 * - Linux: chattr +a (requires root or CAP_LINUX_IMMUTABLE)
 * Throws AppendOnlyFlagError on any failure.
 */
export function applyAppendOnlyFlag(dbPath: string): void {
  if (!existsSync(dbPath)) {
    throw new AppendOnlyFlagError(`file not found: ${dbPath}`)
  }
  const platform = os.platform()
  if (platform === 'darwin') {
    try {
      execFileSync('chflags', ['uappnd', dbPath], { stdio: 'pipe' })
    } catch (err) {
      throw new AppendOnlyFlagError(`chflags uappnd failed: ${(err as Error).message}`)
    }
  } else if (platform === 'linux') {
    try {
      execFileSync('chattr', ['+a', dbPath], { stdio: 'pipe' })
    } catch (err) {
      throw new AppendOnlyFlagError(`chattr +a failed: ${(err as Error).message}`)
    }
  } else {
    throw new AppendOnlyFlagError(`unsupported platform: ${platform}`)
  }
}

/**
 * Safe variant — returns success/failure as a result object instead of throwing.
 * Useful for non-production environments where failure should warn but not abort.
 */
export function applyAppendOnlyFlagSafe(dbPath: string): {
  applied: boolean
  reason?: string
} {
  try {
    applyAppendOnlyFlag(dbPath)
    return { applied: true }
  } catch (err) {
    if (err instanceof AppendOnlyFlagError) {
      return { applied: false, reason: err.reason }
    }
    return { applied: false, reason: String(err) }
  }
}

/**
 * Apply append-only flag with production fail-closed semantics.
 * - production: throws AppendOnlyFlagError on failure
 * - non-production: logs warning and continues
 */
export function applyAppendOnlyFlagAtBoot(
  dbPath: string,
  opts?: { logger?: (msg: string) => void; isProd?: boolean },
): void {
  const isProd =
    opts?.isProd ?? process.env['NODE_ENV'] === 'production'
  const log = opts?.logger ?? ((msg: string): void => console.warn(msg))
  const result = applyAppendOnlyFlagSafe(dbPath)
  if (result.applied) {
    return
  }
  if (isProd) {
    throw new AppendOnlyFlagError(
      `production boot abort — ${result.reason ?? 'unknown'}`,
    )
  }
  log(
    `[agentguard] append-only flag failed (non-prod, continuing): ${result.reason ?? 'unknown'}`,
  )
}
