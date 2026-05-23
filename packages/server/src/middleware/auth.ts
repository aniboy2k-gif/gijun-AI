import type { Request, Response, NextFunction } from 'express'
import { randomInt } from 'node:crypto'
import { getCurrentToken, isTokenValid } from '../auth/token-holder.js'

// fail-mode: B — Startup WARNING when AGENTGUARD_TOKEN missing in middleware load.
// server.ts:5 already handles Tier A boot abort; this duplicate check downgrades to warn
// for environments where middleware is loaded standalone (e.g. tests, library import).
if (!process.env['AGENTGUARD_TOKEN']) {
  console.warn(
    '[agentguard] WARNING: AGENTGUARD_TOKEN is not set. ' +
    'All write endpoints are blocked. Set it in .env.agentguard and restart.',
  )
}

const DEFAULT_FAIL_DELAY_MS = 50
const MAX_FAIL_DELAY_MS = 500

/**
 * Resolve the auth-fail latency baseline from env.
 * - undefined or unparseable → DEFAULT_FAIL_DELAY_MS (50)
 * - negative → 0 (opt-out)
 * - over cap → MAX_FAIL_DELAY_MS (500)
 * - integer in [0, MAX_FAIL_DELAY_MS] → honored
 */
export function resolveAuthFailDelayMs(envValue: string | undefined): number {
  if (envValue === undefined) return DEFAULT_FAIL_DELAY_MS
  const n = Number.parseInt(envValue, 10)
  if (Number.isNaN(n)) return DEFAULT_FAIL_DELAY_MS
  if (n < 0) return 0
  if (n > MAX_FAIL_DELAY_MS) return MAX_FAIL_DELAY_MS
  return n
}

const FAIL_DELAY_MS = resolveAuthFailDelayMs(process.env['AGENTGUARD_AUTH_FAIL_DELAY_MS'])
const JITTER_PCT = 10

// Operator-visible startup notice: makes the current setting auditable in logs.
// (Review M3: opt-out via env=0 is a Tier-B graceful-degrade decision; warn loudly.)
if (FAIL_DELAY_MS === 0) {
  console.warn(
    '[agentguard] WARNING: auth-fail latency baseline is DISABLED ' +
    '(AGENTGUARD_AUTH_FAIL_DELAY_MS=0). Timing side-channel mitigation is OFF.',
  )
} else {
  console.info(
    `[agentguard] auth-fail latency baseline = ${FAIL_DELAY_MS}ms ± ${JITTER_PCT}% jitter`,
  )
}

/**
 * Compute a single jittered delay in [base*(1-pct/100), base*(1+pct/100)].
 * Returns 0 when base is 0 (opt-out).
 */
function jitteredDelay(baseMs: number, jitterPct: number): number {
  if (baseMs <= 0) return 0
  const range = Math.floor((baseMs * jitterPct) / 100)
  if (range === 0) return baseMs
  // randomInt is [min, max) — shift so the window is symmetric around base.
  const offset = randomInt(-range, range + 1)
  return Math.max(0, baseMs + offset)
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Required on every protected route. Only GET /health (mounted in app.ts) skips this. */
export async function requireToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  // fail-mode: A — 503 Server not configured: AGENTGUARD_TOKEN missing at request time (auth-decision surface)
  if (!getCurrentToken()) {
    await sleep(jitteredDelay(FAIL_DELAY_MS, JITTER_PCT))
    res.status(503).json({ error: 'Server not configured: AGENTGUARD_TOKEN missing' })
    return
  }
  const raw = req.headers['x-agentguard-token']
  const provided = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined
  // fail-mode: A — 401 Unauthorized: invalid or missing X-AgentGuard-Token (auth-decision surface)
  if (!isTokenValid(provided)) {
    await sleep(jitteredDelay(FAIL_DELAY_MS, JITTER_PCT))
    res.status(401).json({ error: 'Unauthorized: invalid or missing X-AgentGuard-Token' })
    return
  }
  next()
}
