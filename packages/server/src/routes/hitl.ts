import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { requireToken } from '../middleware/auth.js'
import { evaluateHitl, describeHitlTrigger } from '@gijun-ai/core'

export const hitlRouter: ReturnType<typeof Router> = Router()

const EvaluateBody = z.object({
  action: z.string().min(1).max(1024),
  complexity: z.enum(['trivial', 'standard', 'complex', 'critical']).optional(),
  blastRadius: z.enum(['local', 'project', 'external']).optional(),
  verifyConfidence: z.number().min(0).max(1).optional(),
  verifyVerdict: z.enum(['pass', 'fail', 'partial']).optional(),
})

const evaluateHandler: RequestHandler = (req, res, next) => {
  try {
    const ctx = EvaluateBody.parse(req.body ?? {})
    const trigger = evaluateHitl(ctx)
    res.json({
      triggered: trigger !== null,
      trigger: trigger ?? undefined,
      description: trigger ? describeHitlTrigger(trigger) : undefined,
      note: 'preflight result is advisory — re-validation occurs at execution time',
    })
  } catch (err) { next(err) }
}

hitlRouter.post('/evaluate', requireToken, evaluateHandler)
