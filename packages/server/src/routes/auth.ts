import { Router, type RequestHandler } from 'express'
import { randomBytes } from 'node:crypto'
import { appendAuditEvent } from '@gijun-ai/core'
import { requireToken } from '../middleware/auth.js'
import {
  acquireRotateLock,
  getTokenMetadata,
  releaseRotateLock,
  rotateToken,
} from '../auth/token-holder.js'
import {
  backupEnvFile,
  EnvFileError,
  persistTokenToEnvFile,
  restoreEnvFile,
} from '../auth/env-file.js'

export const authRouter: ReturnType<typeof Router> = Router()

// C1: same-origin / explicit confirmation guard. Loopback binding alone does
// not protect against same-host browser exploits (DNS rebinding, malicious
// local processes). Require both an explicit header and an Origin/Referer
// hostname of 127.0.0.1 or localhost when an Origin is present.
const requireRotateConfirmation: RequestHandler = (req, res, next) => {
  const confirm = req.headers['x-agentguard-confirm-rotate']
  if (confirm !== 'yes') {
    res.status(403).json({ error: 'confirmation_header_missing' })
    return
  }
  const origin = req.headers.origin
  if (origin) {
    try {
      const u = new URL(origin)
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
        res.status(403).json({ error: 'origin_forbidden' })
        return
      }
    } catch {
      res.status(403).json({ error: 'origin_invalid' })
      return
    }
  }
  next()
}

const rotateHandler: RequestHandler = (_req, res, next) => {
  if (!acquireRotateLock()) {
    res.status(409).json({ error: 'rotation_in_progress' })
    return
  }
  try {
    const newToken = randomBytes(32).toString('hex')
    const backup = backupEnvFile()

    // C3 step 2: env-file write first. On failure, abort before any state mutation.
    try {
      persistTokenToEnvFile(newToken)
    } catch (err) {
      if (err instanceof EnvFileError) {
        res.status(500).json({ error: err.code })
        return
      }
      next(err)
      return
    }

    // C3 step 3: audit. On failure, restore env-file and abort.
    try {
      appendAuditEvent({
        eventType: 'auth',
        actor: 'system',
        action: 'token_rotated',
        payload: {
          initiated_by: 'http_endpoint',
          // Keys 'old_token'/'new_token' are also covered by REDACT_KEY_PATTERN;
          // explicit literal here is defensive belt-and-suspenders.
          old_token: '[REDACTED]',
          new_token: '[REDACTED]',
        },
      })
    } catch (err) {
      restoreEnvFile(backup)
      next(err)
      return
    }

    // C3 step 4: holder mutation last. JS sync — no realistic throw path.
    const { rotated_at } = rotateToken(newToken)

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.json({ token: newToken, rotated_at })
  } finally {
    releaseRotateLock()
  }
}

const tokenInfoHandler: RequestHandler = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(getTokenMetadata())
}

authRouter.post('/rotate-token', requireToken, requireRotateConfirmation, rotateHandler)
authRouter.get('/token-info', requireToken, tokenInfoHandler)
