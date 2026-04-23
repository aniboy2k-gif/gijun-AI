import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')

import { runMigrations, closeDb, getDb } from '../db/client.js'
import { createPolicy, evaluate } from '../policy/engine.js'
import { CodedError, ErrorCode } from '../lib/error-codes.js'
import { POLICY_EVAL_SAFE_CAP } from '../lib/limits.js'

before(() => {
  runMigrations()
})

after(() => {
  closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
})

test('policy overflow: below cap evaluates normally', () => {
  // 50 wildcard-matching allow policies — well under the cap.
  for (let i = 0; i < 50; i++) {
    createPolicy({
      policyKind: 'standard',
      toolName: '*',
      resource: '*',
      actionType: 'read',
      effect: 'allow',
    })
  }
  const result = evaluate('anytool', 'read', '*')
  assert.equal(result, 'allow')
})

test(`policy overflow: >=${POLICY_EVAL_SAFE_CAP} matches throws POLICY_OVERFLOW (fail-closed)`, () => {
  // Raw INSERTs to bypass createPolicy — push matching count past POLICY_EVAL_SAFE_CAP.
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO policies (tool_name, resource, action_type, effect, rate_limit, conditions, policy_kind, priority)
    VALUES ('*', '*', 'write', 'allow', NULL, '{}', 'standard', 0)
  `)
  // Already 50 read-allow policies above. We push write-allow '*'/'*' to the cap.
  for (let i = 0; i < POLICY_EVAL_SAFE_CAP; i++) stmt.run()

  assert.throws(
    () => evaluate('anytool', 'write', '*'),
    (e: unknown) => e instanceof CodedError && e.code === ErrorCode.POLICY_OVERFLOW,
    'POLICY_OVERFLOW must fire when matching count hits the safe cap',
  )

  // Audit event must have been appended.
  const last = db.prepare(`
    SELECT event_type FROM audit_events WHERE event_type = 'policy.evaluate.overflow' ORDER BY id DESC LIMIT 1
  `).get() as { event_type: string } | undefined
  assert.ok(last, 'overflow audit event must be recorded')
})
