import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { evaluateHitl, describeHitlTrigger } from '@gijun-ai/core'
import type { ActionContext } from '@gijun-ai/core'

export const hitlRouter: ReturnType<typeof Router> = Router()

const evaluateHandler: RequestHandler = (req, res, next) => {
  try {
    const ctx = req.body as ActionContext
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
