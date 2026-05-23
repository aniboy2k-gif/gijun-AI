import type { Request, Response, NextFunction } from 'express'
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

/** Required on every protected route. Only GET /health (mounted in app.ts) skips this. */
export function requireToken(req: Request, res: Response, next: NextFunction): void {
  // fail-mode: A — 503 Server not configured: AGENTGUARD_TOKEN missing at request time (auth-decision surface)
  if (!getCurrentToken()) {
    res.status(503).json({ error: 'Server not configured: AGENTGUARD_TOKEN missing' })
    return
  }
  const raw = req.headers['x-agentguard-token']
  const provided = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined
  // fail-mode: A — 401 Unauthorized: invalid or missing X-AgentGuard-Token (auth-decision surface)
  if (!isTokenValid(provided)) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing X-AgentGuard-Token' })
    return
  }
  next()
}
