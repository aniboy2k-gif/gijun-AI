import type { Request, Response, NextFunction } from 'express'
import { getCurrentToken, isTokenValid } from '../auth/token-holder.js'

if (!process.env['AGENTGUARD_TOKEN']) {
  console.warn(
    '[agentguard] WARNING: AGENTGUARD_TOKEN is not set. ' +
    'All write endpoints are blocked. Set it in .env.agentguard and restart.',
  )
}

/** Required on every protected route. Only GET /health (mounted in app.ts) skips this. */
export function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (!getCurrentToken()) {
    res.status(503).json({ error: 'Server not configured: AGENTGUARD_TOKEN missing' })
    return
  }
  const raw = req.headers['x-agentguard-token']
  const provided = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined
  if (!isTokenValid(provided)) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing X-AgentGuard-Token' })
    return
  }
  next()
}
