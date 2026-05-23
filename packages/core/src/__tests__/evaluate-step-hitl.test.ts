import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateStepHitl, type ActionContext, type HitlTrigger } from '../hitl/gate.js'

// Covers the 5 trigger reasons of evaluateStepHitl in priority order:
//   irreversible > blast_radius > complexity > verify_fail > low_confidence
// CSR #761 Phase 4 (CSR #793) — CSR body asked for E2E but no HTTP endpoint
// exposes evaluateStepHitl; UNIT coverage is the actual gap.

test('evaluateStepHitl: returns irreversible trigger for action containing "DROP TABLE"', () => {
  const ctx: ActionContext = { action: 'DROP TABLE users CASCADE' }
  const trigger = evaluateStepHitl(ctx)
  assert.ok(trigger, 'must return a trigger, not null')
  assert.equal(trigger.reason, 'irreversible')
  assert.equal((trigger as Extract<HitlTrigger, { reason: 'irreversible' }>).pattern, 'DROP TABLE')
})

test('evaluateStepHitl: irreversible matches case-insensitively (lowercase action)', () => {
  // The implementation upper-cases both sides, so lower-case action text
  // containing the pattern still matches.
  const trigger = evaluateStepHitl({ action: 'sudo rm -rf /tmp/cache' })
  assert.ok(trigger)
  assert.equal(trigger.reason, 'irreversible')
  assert.equal((trigger as Extract<HitlTrigger, { reason: 'irreversible' }>).pattern, 'rm -rf')
})

test('evaluateStepHitl: returns blast_radius trigger when blastRadius=external (and no irreversible match)', () => {
  const trigger = evaluateStepHitl({
    action: 'POST to upstream payment provider',
    blastRadius: 'external',
  })
  assert.ok(trigger)
  assert.equal(trigger.reason, 'blast_radius')
  assert.equal((trigger as Extract<HitlTrigger, { reason: 'blast_radius' }>).scope, 'external')
})

test('evaluateStepHitl: returns complexity trigger when complexity=critical (and no higher-priority match)', () => {
  const trigger = evaluateStepHitl({
    action: 'refactor auth module',
    complexity: 'critical',
  })
  assert.ok(trigger)
  assert.equal(trigger.reason, 'complexity')
  assert.equal((trigger as Extract<HitlTrigger, { reason: 'complexity' }>).level, 'critical')
})

test('evaluateStepHitl: returns verify_fail trigger when verifyVerdict=fail', () => {
  const trigger = evaluateStepHitl({
    action: 'commit code',
    verifyVerdict: 'fail',
  })
  assert.ok(trigger)
  assert.equal(trigger.reason, 'verify_fail')
  assert.equal((trigger as Extract<HitlTrigger, { reason: 'verify_fail' }>).verdict, 'fail')
})

test('evaluateStepHitl: returns low_confidence trigger when verifyConfidence < 0.7', () => {
  const trigger = evaluateStepHitl({
    action: 'apply migration',
    verifyConfidence: 0.65,
  })
  assert.ok(trigger)
  assert.equal(trigger.reason, 'low_confidence')
  assert.equal(
    (trigger as Extract<HitlTrigger, { reason: 'low_confidence' }>).confidence,
    0.65,
  )
})

test('evaluateStepHitl: priority — irreversible beats blast_radius+complexity+verify_fail+low_confidence on the same context', () => {
  // All five conditions are satisfied; the implementation picks irreversible
  // first because the action matches an IRREVERSIBLE_PATTERN.
  const trigger = evaluateStepHitl({
    action: 'DELETE FROM tasks WHERE id < 1000',
    blastRadius: 'external',
    complexity: 'critical',
    verifyVerdict: 'fail',
    verifyConfidence: 0.1,
  })
  assert.ok(trigger)
  assert.equal(trigger.reason, 'irreversible', 'irreversible must win over all other reasons')
})

test('evaluateStepHitl: returns null when no condition triggers HITL', () => {
  const trigger = evaluateStepHitl({
    action: 'read user profile',
    complexity: 'trivial',
    blastRadius: 'local',
    verifyVerdict: 'pass',
    verifyConfidence: 0.95,
  })
  assert.equal(trigger, null, 'safe context must return null (no HITL required)')
})
