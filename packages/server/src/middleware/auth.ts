import type { Request, Response, NextFunction } from 'express'
import { safeTokenCompare } from '@gijun-ai/core'

const TOKEN = process.env.AGENTGUARD_TOKEN

if (!TOKEN) {
  console.warn(
    '[agentguard] WARNING: AGENTGUARD_TOKEN is not set. ' +
    'All write endpoints are blocked. Set it in .env.agentguard and restart.',
  )
}

/** Protects write endpoints. Read-only GET routes skip this middleware. */
export function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (!TOKEN) {
    res.status(503).json({ error: 'Server not configured: AGENTGUARD_TOKEN missing' })
    return
  }
  const raw = req.headers['x-agentguard-token']
  const provided = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined
  if (!safeTokenCompare(provided, TOKEN)) {
    res.status(401).json({ error: 'Unauthorized: invalid or missing X-AgentGuard-Token' })
    return
  }
  next()
}
