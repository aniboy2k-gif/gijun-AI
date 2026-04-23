import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')

import { withTxAndAudit } from '../lib/tx.js'
import { runMigrations, closeDb, getDb } from '../db/client.js'
import { tailAuditEvents } from '../audit/service.js'

before(() => {
  runMigrations()
})

after(() => {
  closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
})

test('withTxAndAudit: happy path commits both state change and audit', () => {
  const before = (tailAuditEvents(200) as Array<{ event_type: string }>).length
  const returned = withTxAndAudit<number>(db => {
    const res = db.prepare(`
      INSERT INTO tasks (title, complexity, tags, ai_context)
      VALUES (?, 'standard', '[]', '{}')
    `).run('atomicity happy')
    const id = res.lastInsertRowid as number
    return {
      result: id,
      audit: { eventType: 'task.create', action: `created ${id}`, resourceType: 'task', resourceId: String(id) },
    }
  })
  assert.ok(returned > 0)
  const row = getDb().prepare('SELECT id FROM tasks WHERE id = ?').get(returned) as { id: number } | undefined
  assert.ok(row, 'task row must be committed')
  const afterCount = (tailAuditEvents(200) as Array<{ event_type: string }>).length
  assert.equal(afterCount, before + 1, 'exactly one audit event must be appended')
})

test('withTxAndAudit: rollback when fn throws after state change — no partial commit', () => {
  const beforeTasks = (getDb().prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c
  const beforeAudit = (tailAuditEvents(500) as unknown[]).length

  assert.throws(() => {
    withTxAndAudit<number>(db => {
      db.prepare(`INSERT INTO tasks (title, complexity, tags, ai_context) VALUES (?, 'standard', '[]', '{}')`)
        .run('should roll back')
      throw new Error('simulated failure after state change')
    })
  }, /simulated failure/)

  const afterTasks = (getDb().prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c
  const afterAudit = (tailAuditEvents(500) as unknown[]).length
  assert.equal(afterTasks, beforeTasks, 'task row must be rolled back')
  assert.equal(afterAudit, beforeAudit, 'no audit event must be appended on rollback')
})

test('withTxAndAudit: rollback when audit fails — audit-first policy preserves no silent loss', () => {
  const beforeTasks = (getDb().prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c

  assert.throws(() => {
    withTxAndAudit<number>(db => {
      db.prepare(`INSERT INTO tasks (title, complexity, tags, ai_context) VALUES (?, 'standard', '[]', '{}')`)
        .run('audit-fail case')
      return {
        result: 0,
        // Invalid audit input — empty eventType triggers Zod validation error during insertAuditEventInTx.
        audit: { eventType: '', action: 'bad audit' },
      }
    })
  })

  const afterTasks = (getDb().prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c
  assert.equal(afterTasks, beforeTasks, 'state change must be rolled back when audit fails')
})
