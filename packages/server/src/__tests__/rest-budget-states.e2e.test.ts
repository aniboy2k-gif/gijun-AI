import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')
process.env['AGENTGUARD_TOKEN'] = 'test-token-budget-states'

const { createApp } = await import('../app.js')
const core = await import('@gijun-ai/core')

const TOKEN = 'test-token-budget-states'
let server: Server
let baseUrl: string

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-AgentGuard-Token': TOKEN }
}

// Each test gets a fresh budget+trace state so the global cost breakdown does
// not bleed between scenarios (getCostBreakdown is keyed on period only — no
// per-policy toolName/resource filter).
function resetBudgetState(): void {
  const db = core.getDb()
  db.exec('DELETE FROM traces')
  db.exec("DELETE FROM policies WHERE policy_kind = 'budget'")
}

function makeBudgetPolicy(opts: {
  usdLimit: number
  warningThreshold?: number
  criticalThreshold?: number
  toolName?: string
  resource?: string
  priority?: number
}): number {
  return core.createPolicy({
    policyKind: 'budget',
    toolName: opts.toolName ?? '*',
    resource: opts.resource ?? '*',
    priority: opts.priority ?? 100,
    conditions: {
      period: '24h',
      usd_limit: opts.usdLimit,
      warning_threshold: opts.warningThreshold ?? 0.8,
      critical_threshold: opts.criticalThreshold ?? 0.95,
    },
  })
}

function recordCost(costUsd: number): void {
  core.recordTrace(core.generateTraceId(), { costUsd, operation: 'budget-test' })
}

async function postCheck(body: { toolName?: string; resource?: string } = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/budget/check`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

type AuditTailRow = {
  id: number
  event_type: string
  resource_id: string | null
  payload: string
}

async function lastAuditEventOfType(eventType: string): Promise<AuditTailRow | undefined> {
  const res = await fetch(`${baseUrl}/audit?n=200`, { headers: authHeaders() })
  assert.equal(res.status, 200)
  const events = (await res.json()) as AuditTailRow[]
  return events.find((e) => e.event_type === eventType)
}

before(async () => {
  core.runMigrations()
  const app = createApp()
  await new Promise<void>((resolvePromise) => {
    server = app.listen(0, '127.0.0.1', () => resolvePromise())
  })
  const addr = server.address()
  if (typeof addr !== 'object' || addr === null) throw new Error('unexpected address')
  baseUrl = `http://127.0.0.1:${addr.port}`
})

after(async () => {
  await new Promise<void>((resolvePromise) => {
    server.close(() => resolvePromise())
  })
  core.closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
  delete process.env['AGENTGUARD_TOKEN']
})

test('E2E budget: returns no_policy when no active budget policy exists', async () => {
  resetBudgetState()
  const { status, body } = await postCheck()
  assert.equal(status, 200, 'POST /budget/check must return 200')
  assert.equal((body as { status: string }).status, 'no_policy')
})

test('E2E budget: returns no_cost_data when policy exists but no traces recorded', async () => {
  resetBudgetState()
  makeBudgetPolicy({ usdLimit: 100 })
  const { status, body } = await postCheck()
  assert.equal(status, 200)
  const result = body as { status: string; limitUsd: number }
  assert.equal(result.status, 'no_cost_data')
  assert.equal(result.limitUsd, 100)
})

test('E2E budget: returns under_budget when cost < warning_threshold', async () => {
  resetBudgetState()
  makeBudgetPolicy({ usdLimit: 100, warningThreshold: 0.8, criticalThreshold: 0.95 })
  recordCost(50) // 50% — under 80% warning threshold
  const { status, body } = await postCheck()
  assert.equal(status, 200)
  const result = body as { status: string; currentUsd: number; limitUsd: number }
  assert.equal(result.status, 'under_budget')
  assert.equal(result.currentUsd, 50)
  assert.equal(result.limitUsd, 100)
})

test('E2E budget: returns warning when warning_threshold ≤ cost < critical_threshold + emits budget.warning audit event', async () => {
  resetBudgetState()
  makeBudgetPolicy({ usdLimit: 100, warningThreshold: 0.8, criticalThreshold: 0.95 })
  recordCost(85) // 85% — between 80% warning and 95% critical
  const { status, body } = await postCheck()
  assert.equal(status, 200)
  const result = body as { status: string; currentUsd: number; threshold: number }
  assert.equal(result.status, 'warning')
  assert.equal(result.currentUsd, 85)
  assert.equal(result.threshold, 0.8)

  const evt = await lastAuditEventOfType('budget.warning')
  assert.ok(evt, 'warning status must emit budget.warning audit event')
})

test('E2E budget: returns critical when critical_threshold ≤ cost < limit + emits budget.critical audit event', async () => {
  resetBudgetState()
  makeBudgetPolicy({ usdLimit: 100, warningThreshold: 0.8, criticalThreshold: 0.95 })
  recordCost(97) // 97% — above 95% critical, below 100% limit
  const { status, body } = await postCheck()
  assert.equal(status, 200)
  const result = body as { status: string; currentUsd: number; threshold: number }
  assert.equal(result.status, 'critical')
  assert.equal(result.currentUsd, 97)
  assert.equal(result.threshold, 0.95)

  const evt = await lastAuditEventOfType('budget.critical')
  assert.ok(evt, 'critical status must emit budget.critical audit event')
})

test('E2E budget: returns over_budget when cost ≥ limit + emits budget.over_budget audit event with overage', async () => {
  resetBudgetState()
  makeBudgetPolicy({ usdLimit: 100 })
  recordCost(120) // 120% — over budget by $20
  const { status, body } = await postCheck()
  assert.equal(status, 200)
  const result = body as { status: string; currentUsd: number; limitUsd: number; overage: number }
  assert.equal(result.status, 'over_budget')
  assert.equal(result.currentUsd, 120)
  assert.equal(result.limitUsd, 100)
  assert.equal(result.overage, 20)

  const evt = await lastAuditEventOfType('budget.over_budget')
  assert.ok(evt, 'over_budget status must emit budget.over_budget audit event')
  const payload = JSON.parse(evt.payload) as { overage?: number }
  assert.equal(payload.overage, 20, 'audit payload must record overage amount')
})

test('E2E budget: returns invalid + emits budget.invalid audit event when policy conditions JSON cannot be parsed', async () => {
  resetBudgetState()
  // Direct INSERT to bypass createPolicy schema validation — simulates a
  // legacy/migrated policy with malformed conditions JSON.
  const db = core.getDb()
  const result = db.prepare(`
    INSERT INTO policies
      (tool_name, resource, action_type, effect, rate_limit, conditions, policy_kind, priority, is_active)
    VALUES ('*', '*', 'read', 'allow', NULL, ?, 'budget', 100, 1)
  `).run('{"period":"24h","usd_limit":"not-a-number"}') // schema requires usd_limit > 0 number
  const policyId = result.lastInsertRowid as number

  const { status, body } = await postCheck()
  assert.equal(status, 200)
  const responseBody = body as { status: string; policyId: number; reason: string }
  assert.equal(responseBody.status, 'invalid')
  assert.equal(responseBody.policyId, policyId)
  assert.ok(responseBody.reason.length > 0, 'invalid status must include parse error reason')

  const evt = await lastAuditEventOfType('budget.invalid')
  assert.ok(evt, 'invalid status must emit budget.invalid audit event')
})
