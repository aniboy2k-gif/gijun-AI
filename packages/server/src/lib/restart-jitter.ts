// CSR #777 Phase 2-b (R2-M4): worker restart cadence jitter helper.
//
// **Reserved for future use.** The current server enforces a single-process
// topology — boot rejects any cluster/worker_threads/forked-child detection.
// If that topology ever changes to a cluster mode where a process manager
// (PM2, systemd, k8s) restarts workers, the restart cadence must be jittered
// to avoid a side-channel that reveals rotation state via observable
// restart-pattern timing.
//
// This module is intentionally **dormant**: nothing in the current codebase
// calls `computeRestartDelay`. It is shipped as a unit-tested helper so that
// future process-manager integrations (e.g., `ecosystem.config.js`) can
// import a single, reviewed implementation rather than re-deriving the math.
//
// Marker: this file does not host a `fail-mode:` sentinel because it is a
// dormant utility, not an active failure-handling path. When activated, the
// caller should register a `fail-mode:` sentinel in the activation site (e.g.,
// the process manager bootstrap script) and add a row to
// `docs/failure-mode-policy.md` §2.

import { randomInt } from 'node:crypto'

/**
 * Compute a jittered restart delay.
 *
 * @param baseMs   The nominal restart cadence in milliseconds. Negative values clamp to 0.
 * @param jitterPct The jitter percentage (e.g., 10 means ±10%). Values outside [0, 100] clamp to [0, 100].
 * @returns A delay in milliseconds within [baseMs * (1 - jitterPct/100), baseMs * (1 + jitterPct/100)].
 *
 * @example
 *   computeRestartDelay(1000, 10)  // → some value in [900, 1100]
 *   computeRestartDelay(0, 10)     // → 0 (clamped)
 *   computeRestartDelay(-5, 10)    // → 0 (negative clamp)
 *   computeRestartDelay(1000, 0)   // → 1000 (no jitter)
 */
export function computeRestartDelay(baseMs: number, jitterPct: number): number {
  if (!Number.isFinite(baseMs) || baseMs <= 0) return 0
  const pct = Math.max(0, Math.min(100, jitterPct))
  const base = Math.floor(baseMs)
  if (pct === 0) return base
  const range = Math.floor((base * pct) / 100)
  if (range === 0) return base
  // randomInt(a, b) returns integer in [a, b).
  const offset = randomInt(-range, range + 1)
  return Math.max(0, base + offset)
}
