import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')
process.env['GIJUN_HITL_STRICT_MODE'] = '1'

import { createTask } from '../task/service.js'
import { runMigrations, closeDb, getDb } from '../db/client.js'

before(() => {
  runMigrations()
})

after(() => {
  closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
  delete process.env['GIJUN_HITL_STRICT_MODE']
})

test('hitl_trigger is immutable at DB level — raw UPDATE rejected (NH4)', () => {
  const id = createTask({
    title: 'immutable check',
    complexity: 'critical',
    toolName: 'bash',
    actionType: 'execute',
    resource: 'prod',
  })

  const db = getDb()
  const stmt = db.prepare('UPDATE tasks SET hitl_trigger = ? WHERE id = ?')

  assert.throws(
    () => stmt.run(JSON.stringify({ tampered: true }), id),
    /hitl_trigger is immutable once set/,
    'DB trigger must reject UPDATE of hitl_trigger',
  )
})
