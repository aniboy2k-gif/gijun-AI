import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { randomBytes } from 'node:crypto'
import { ErrorCode, CodedError, toPublicFieldErrors } from '@gijun-ai/core'

function hasCode(e: unknown): e is { code: string; message: string } {
  return typeof e === 'object' && e !== null && 'code' in e &&
    typeof (e as { code: unknown }).code === 'string'
}

const CODE_TO_HTTP: Record<string, number> = {
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.HITL_REQUIRED]: 409,
  [ErrorCode.POLICY_OVERFLOW]: 500,
  [ErrorCode.VALIDATION]: 400,
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation error',
      fieldErrors: toPublicFieldErrors(err),
    })
    return
  }

  if (err instanceof CodedError || hasCode(err)) {
    const code = (err as { code: string }).code
    const status = CODE_TO_HTTP[code] ?? 500
    if (status >= 500) {
      const requestId = randomBytes(8).toString('hex')
      console.error(`[agentguard] server-side error code=${code} requestId=${requestId}`, err)
      res.status(status).json({ error: code, requestId })
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    res.status(status).json({ error: code, detail: message })
    return
  }

  const requestId = randomBytes(8).toString('hex')
  console.error(`[agentguard] Unhandled error requestId=${requestId}:`, err)
  res.status(500).json({ error: 'Internal server error', requestId })
}
