import express, { type Express } from 'express'
import { tasksRouter } from './routes/tasks.js'
import { auditRouter } from './routes/audit.js'
import { knowledgeRouter } from './routes/knowledge.js'
import { playbooksRouter } from './routes/playbooks.js'
import { incidentsRouter } from './routes/incidents.js'
import { policiesRouter } from './routes/policies.js'
import { tracesRouter } from './routes/traces.js'
import { verifyRouter } from './routes/verify.js'
import { hitlRouter } from './routes/hitl.js'
import { preflightRouter } from './routes/preflight.js'
import { budgetRouter } from './routes/budget.js'
import { errorHandler } from './middleware/error.js'

export function createApp(): Express {
  const app = express()
  app.use(express.json())

  app.get('/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }))

  app.use('/tasks', tasksRouter)
  app.use('/audit', auditRouter)
  app.use('/knowledge', knowledgeRouter)
  app.use('/playbooks', playbooksRouter)
  app.use('/incidents', incidentsRouter)
  app.use('/policies', policiesRouter)
  app.use('/traces', tracesRouter)
  app.use('/verifications', verifyRouter)
  app.use('/hitl', hitlRouter)
  app.use('/preflight', preflightRouter)
  app.use('/budget', budgetRouter)

  app.use(errorHandler)
  return app
}
