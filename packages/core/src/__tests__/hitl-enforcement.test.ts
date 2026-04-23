import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')
process.env['GIJUN_HITL_STRICT_MODE'] = '1'

import { createTask, updateTaskStatus, approveHitl, getTask } from '../task/service.js'
import { runMigrations, closeDb } from '../db/client.js'
import { CodedError, ErrorCode } from '../lib/error-codes.js'

before(() => {
  runMigrations()
})

after(() => {
  closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
  delete process.env['GIJUN_HITL_STRICT_MODE']
})

test('HITL enforcement: critical task cannot transition to done without approval', () => {
  const id = createTask({
    title: 'critical task',
    complexity: 'critical',
    toolName: 'bash',
    actionType: 'execute',
    resource: 'prod-db',
  })
  const row = getTask(id)
  assert.ok(row)
  assert.equal(row.hitl_required, 1, 'critical task must flag hitl_required=1')
  assert.equal(row.hitl_approved_at, null, 'new task has no approval yet')

  assert.throws(
    () => updateTaskStatus(id, 'done'),
    (e: unknown) => e instanceof CodedError && e.code === ErrorCode.HITL_REQUIRED,
    'updateTaskStatus(done) must reject when HITL pending',
  )
})

test('HITL enforcement: approveHitl unblocks done transition', () => {
  const id = createTask({
    title: 'critical task 2',
    complexity: 'critical',
    toolName: 'bash',
    actionType: 'execute',
    resource: 'prod-db',
  })

  approveHitl(id)

  // After approval, done transition must succeed.
  updateTaskStatus(id, 'done')
  const row = getTask(id)
  assert.equal(row?.status, 'done')
  assert.ok(row?.hitl_approved_at, 'approved_at must be set after approveHitl')
})

test('HITL enforcement: trivial task can transition to done freely', () => {
  const id = createTask({ title: 'trivial task', complexity: 'trivial' })
  const row = getTask(id)
  assert.equal(row?.hitl_required, 0)
  updateTaskStatus(id, 'done')
  const after = getTask(id)
  assert.equal(after?.status, 'done')
})

test('HITL enforcement: updateTaskStatus on non-existent task throws NOT_FOUND', () => {
  assert.throws(
    () => updateTaskStatus(999_999, 'done'),
    (e: unknown) => e instanceof CodedError && e.code === ErrorCode.NOT_FOUND,
  )
})

test('HITL trigger JSON carries versioned metadata (ruleVersion/evaluator/evaluatedAt)', () => {
  const id = createTask({
    title: 'meta task',
    complexity: 'critical',
    toolName: 'bash',
    actionType: 'execute',
    resource: 'svc',
  })
  const row = getTask(id)
  assert.ok(row?.hitl_trigger)
  const trigger = JSON.parse(row.hitl_trigger) as {
    ruleVersion: number
    evaluator: string
    evaluatedAt: string
    axes: string[]
    mode: string
  }
  assert.equal(trigger.ruleVersion, 1)
  assert.equal(trigger.evaluator, 'hitl-gate-v1')
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(trigger.evaluatedAt), 'evaluatedAt must be ISO')
  assert.ok(trigger.axes.includes('critical_complexity'))
  assert.equal(trigger.mode, 'full')
})
