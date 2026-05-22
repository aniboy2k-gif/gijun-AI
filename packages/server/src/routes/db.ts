import { Router, type RequestHandler } from 'express'
import { statSync } from 'node:fs'
import { currentDbPath, getDb } from '@gijun-ai/core'
import { requireToken } from '../middleware/auth.js'

export const dbRouter: ReturnType<typeof Router> = Router()

// H4: COUNT(*) on large append-only tables (audit_events) is O(N) under
// better-sqlite3's synchronous driver and would block the event loop.
// MAX(id) is O(1) for monotonic-PK tables — accurate upper bound, labeled
// 'approximate' in UI.
function maxId(db: ReturnType<typeof getDb>, table: string): number {
  const row = db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${table}`).get() as { m: number }
  return row.m
}

const statsHandler: RequestHandler = (_req, res, next) => {
  try {
    const db = getDb()
    const tasks = maxId(db, 'tasks')
    const audit_events = maxId(db, 'audit_events')
    const knowledge_items = maxId(db, 'knowledge_items')
    const db_path = currentDbPath()
    let db_size_bytes: number | null = null
    try {
      if (db_path && db_path !== ':memory:') {
        db_size_bytes = statSync(db_path).size
      }
    } catch {
      db_size_bytes = null
    }
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      tasks,
      audit_events,
      knowledge_items,
      db_path,
      db_size_bytes,
      counts_are_approximate: true,
    })
  } catch (err) { next(err) }
}

dbRouter.get('/stats', requireToken, statsHandler)
