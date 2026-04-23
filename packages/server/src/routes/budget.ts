import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { checkBudget } from '@gijun-ai/core'
import { z } from 'zod'

export const budgetRouter: ReturnType<typeof Router> = Router()

const CheckBudgetBody = z.object({
  toolName: z.string().optional(),
  resource: z.string().optional(),
})

const checkHandler: RequestHandler = (req, res, next) => {
  try {
    const { toolName, resource } = CheckBudgetBody.parse(req.body ?? {})
    const opts: { toolName?: string; resource?: string } = {}
    if (toolName !== undefined) opts.toolName = toolName
    if (resource !== undefined) opts.resource = resource
    res.json(checkBudget(opts))
  } catch (err) { next(err) }
}

budgetRouter.post('/check', requireToken, checkHandler)
