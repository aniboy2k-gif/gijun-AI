import { Router, type RequestHandler } from 'express'
import { requireToken } from '../middleware/auth.js'
import { recordVerification } from '@gijun-ai/core'

export const verifyRouter: ReturnType<typeof Router> = Router()

const createHandler: RequestHandler = (req, res, next) => {
  try {
    const id = recordVerification(req.body)
    res.status(201).json({ id })
  } catch (err) { next(err) }
}

verifyRouter.post('/', requireToken, createHandler)
