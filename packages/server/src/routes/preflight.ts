import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { evaluatePolicy, evaluateHitl, describeHitlTrigger } from '@gijun-ai/core'
import type { ActionContext } from '@gijun-ai/core'

export const preflightRouter: ReturnType<typeof Router> = Router()

/**
 * POST /preflight — advisory pre-flight check combining policy + HITL evaluation.
 * Re-validation MUST occur at the actual execution endpoint — this result
 * is advisory only (TOCTOU applies in concurrent scenarios).
 */
const preflightHandler: RequestHandler = (req, res, next) => {
  try {
    const { action, toolName, actionType, complexity } = req.body as {
      action: string; toolName?: string
      actionType?: 'read' | 'write' | 'execute' | 'delete'
      complexity?: ActionContext['complexity']
    }

    // Step 1: policy evaluation (if toolName + actionType provided)
    if (toolName && actionType) {
      const policyResult = evaluatePolicy(toolName, actionType, undefined, undefined)
      if (policyResult !== 'allow') {
        res.json({
          allowed: false,
          reason: policyResult === 'deny' ? 'POLICY_DENIED' : 'RATE_LIMITED',
          note: 'preflight result is advisory',
        })
        return
      }
    }

    // Step 2: HITL evaluation
    const ctx: ActionContext = { action, complexity }
    const trigger = evaluateHitl(ctx)
    if (trigger) {
      res.json({
        allowed: false,
        hitlRequired: true,
        trigger,
        description: describeHitlTrigger(trigger),
        note: 'preflight result is advisory',
      })
      return
    }

    res.json({ allowed: true, note: 'preflight result is advisory' })
  } catch (err) { next(err) }
}

preflightRouter.post('/', requireToken, preflightHandler)
