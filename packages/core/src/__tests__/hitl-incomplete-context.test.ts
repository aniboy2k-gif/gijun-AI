import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateHitlForTask } from '../hitl/gate.js'

test('incomplete context: critical always requires HITL regardless of env', () => {
  const strict = evaluateHitlForTask(
    { complexity: 'critical' },
    { env: { GIJUN_HITL_STRICT_MODE: '1' } as NodeJS.ProcessEnv },
  )
  const loose = evaluateHitlForTask(
    { complexity: 'critical' },
    { env: { GIJUN_HITL_STRICT_MODE: '0' } as NodeJS.ProcessEnv },
  )
  assert.equal(strict.hitlRequired, true)
  assert.equal(loose.hitlRequired, true, 'critical complexity is never downgraded')
  assert.ok(strict.trigger.axes.includes('critical_complexity'))
})

test('incomplete context: complex with full fields requires HITL in both modes', () => {
  const input = {
    complexity: 'complex' as const,
    toolName: 't',
    actionType: 'execute' as const,
    resource: 'r',
  }
  const strict = evaluateHitlForTask(input, { env: { GIJUN_HITL_STRICT_MODE: '1' } as NodeJS.ProcessEnv })
  const loose = evaluateHitlForTask(input, { env: { GIJUN_HITL_STRICT_MODE: '0' } as NodeJS.ProcessEnv })
  assert.equal(strict.hitlRequired, true)
  assert.equal(loose.hitlRequired, true)
  assert.equal(strict.trigger.mode, 'full')
  assert.equal(loose.trigger.mode, 'full')
})

test('incomplete context: complex without fields — strict=1 requires HITL, strict=0 downgrades with warning axis', () => {
  const input = { complexity: 'complex' as const }
  const strict = evaluateHitlForTask(input, { env: { GIJUN_HITL_STRICT_MODE: '1' } as NodeJS.ProcessEnv })
  const loose = evaluateHitlForTask(input, { env: { GIJUN_HITL_STRICT_MODE: '0' } as NodeJS.ProcessEnv })

  assert.equal(strict.hitlRequired, true, 'strict mode: missing fields escalate complex to HITL')
  assert.ok(strict.trigger.axes.includes('incomplete_context'))
  assert.equal(strict.trigger.mode, 'complexity-only')

  assert.equal(loose.hitlRequired, false, 'v0.1.1 default: backwards-compatible pass')
  assert.ok(loose.trigger.axes.includes('strict_mode_downgraded'))
})

test('incomplete context: default env (no GIJUN_HITL_STRICT_MODE) enforces HITL for complex without fields', () => {
  // v0.1.2: strict is the default. GIJUN_HITL_STRICT_MODE=0 opts out.
  const defaultDecision = evaluateHitlForTask(
    { complexity: 'complex' },
    { env: {} as NodeJS.ProcessEnv },  // no GIJUN_HITL_STRICT_MODE set
  )
  assert.equal(defaultDecision.hitlRequired, true, 'default should now require HITL (strict by default)')
  assert.ok(defaultDecision.trigger.axes.includes('incomplete_context'))
})

test('incomplete context: trivial and standard are never escalated', () => {
  for (const c of ['trivial', 'standard'] as const) {
    const decision = evaluateHitlForTask(
      { complexity: c },
      { env: { GIJUN_HITL_STRICT_MODE: '1' } as NodeJS.ProcessEnv },
    )
    assert.equal(decision.hitlRequired, false, `${c} must not require HITL`)
  }
})
