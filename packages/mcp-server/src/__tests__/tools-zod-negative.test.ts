import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { TOOLS } from '../tools.js'

// Per-tool minimum-invalid input fixtures.
// Goal: pin every WRITE tool's required-field contract and every enum/length boundary.
// VerifyAudit (z.object({})) cannot have an "invalid object" beyond non-object inputs;
// the universal non-object checks below cover that.
type InvalidCase = { name: string; input: unknown; reason: string }

const INVALID: Record<string, InvalidCase[]> = {
  list_tasks: [
    { name: 'limit zero', input: { limit: 0 }, reason: 'limit min(1)' },
    { name: 'limit too big', input: { limit: 999 }, reason: 'limit max(200)' },
    { name: 'limit string', input: { limit: 'ten' }, reason: 'limit must be int' },
  ],
  get_task: [
    { name: 'missing id', input: {}, reason: 'id required' },
    { name: 'id string', input: { id: 'abc' }, reason: 'id must be int' },
    { name: 'id float', input: { id: 1.5 }, reason: 'id must be int' },
  ],
  tail_audit: [
    { name: 'n zero', input: { n: 0 }, reason: 'n min(1)' },
    { name: 'n too big', input: { n: 999 }, reason: 'n max(200)' },
    { name: 'n string', input: { n: 'twenty' }, reason: 'n must be int' },
  ],
  verify_audit_integrity: [],
  search_knowledge: [
    { name: 'missing query', input: {}, reason: 'query required' },
    { name: 'empty query', input: { query: '' }, reason: 'query min(1)' },
    { name: 'limit zero', input: { query: 'x', limit: 0 }, reason: 'limit min(1)' },
  ],
  get_playbook: [
    { name: 'missing idOrSlug', input: {}, reason: 'idOrSlug required' },
    { name: 'empty idOrSlug', input: { idOrSlug: '' }, reason: 'idOrSlug min(1)' },
  ],
  get_cost_summary: [
    { name: 'invalid period', input: { period: 'forever' }, reason: 'period enum' },
  ],
  check_budget: [
    { name: 'toolName int', input: { toolName: 123 }, reason: 'toolName must be string' },
    { name: 'resource int', input: { resource: 456 }, reason: 'resource must be string' },
  ],
  preflight_check: [
    { name: 'missing action', input: {}, reason: 'action required' },
    { name: 'empty action', input: { action: '' }, reason: 'action min(1)' },
    { name: 'invalid actionType', input: { action: 'x', actionType: 'invalid' }, reason: 'actionType enum' },
    { name: 'invalid complexity', input: { action: 'x', complexity: 'invalid' }, reason: 'complexity enum' },
  ],
  create_task: [
    { name: 'missing title', input: {}, reason: 'title required' },
    { name: 'empty title', input: { title: '' }, reason: 'title min(1)' },
    { name: 'invalid complexity', input: { title: 't', complexity: 'invalid' }, reason: 'complexity enum' },
    { name: 'tags not array', input: { title: 't', tags: 'tag' }, reason: 'tags must be array' },
  ],
  update_task_status: [
    { name: 'missing fields', input: {}, reason: 'id+status required' },
    { name: 'missing status', input: { id: 1 }, reason: 'status required' },
    { name: 'invalid status', input: { id: 1, status: 'invalid' }, reason: 'status enum' },
    { name: 'id string', input: { id: 'abc', status: 'pending' }, reason: 'id must be int' },
  ],
  add_task_step: [
    { name: 'missing fields', input: {}, reason: 'id+stepNo required' },
    { name: 'missing stepNo', input: { id: 1 }, reason: 'stepNo required' },
    { name: 'stepNo zero', input: { id: 1, stepNo: 0 }, reason: 'stepNo min(1)' },
  ],
  // approve_hitl removed from MCP — no INVALID entry needed
  append_audit: [
    { name: 'missing fields', input: {}, reason: 'eventType+action required' },
    { name: 'missing action', input: { eventType: 'x' }, reason: 'action required' },
    { name: 'empty eventType', input: { eventType: '', action: 'x' }, reason: 'eventType min(1)' },
    { name: 'empty action', input: { eventType: 'x', action: '' }, reason: 'action min(1)' },
    { name: 'invalid actor', input: { eventType: 'x', action: 'y', actor: 'alien' }, reason: 'actor enum' },
  ],
  create_knowledge: [
    { name: 'missing fields', input: {}, reason: 'layer+title+content required' },
    { name: 'invalid layer', input: { layer: 'invalid', title: 't', content: 'c' }, reason: 'layer enum' },
    { name: 'empty title', input: { layer: 'global', title: '', content: 'c' }, reason: 'title min(1)' },
    { name: 'empty content', input: { layer: 'global', title: 't', content: '' }, reason: 'content min(1)' },
  ],
  promote_knowledge: [
    { name: 'missing id', input: {}, reason: 'id required' },
    { name: 'id string', input: { id: 'abc' }, reason: 'id must be int' },
  ],
  report_incident: [
    { name: 'missing fields', input: {}, reason: 'title+description required' },
    { name: 'missing description', input: { title: 't' }, reason: 'description required' },
    { name: 'empty title', input: { title: '', description: 'd' }, reason: 'title min(1)' },
    { name: 'invalid severity', input: { title: 't', description: 'd', severity: 'apocalyptic' }, reason: 'severity enum' },
  ],
  // Knowledge lifecycle tools (migration 007+)
  get_knowledge_drafts: [
    { name: 'invalid layer', input: { layer: 'invalid' }, reason: 'layer enum' },
    { name: 'limit zero', input: { limit: 0 }, reason: 'limit min(1)' },
  ],
  create_da_candidate: [
    { name: 'missing fields', input: {}, reason: 'title+content+reasoning+targetLayer required' },
    { name: 'empty title', input: { title: '', content: 'c', reasoning: 'r', targetLayer: 'incident' }, reason: 'title min(1)' },
    { name: 'invalid targetLayer', input: { title: 't', content: 'c', reasoning: 'r', targetLayer: 'candidate' }, reason: 'targetLayer enum' },
  ],
  nominate_knowledge_candidate: [
    { name: 'missing id', input: {}, reason: 'id required' },
    { name: 'id string', input: { id: 'abc' }, reason: 'id must be int' },
  ],
  approve_knowledge_candidate: [
    { name: 'missing id', input: {}, reason: 'id required' },
    { name: 'id float', input: { id: 1.5 }, reason: 'id must be int' },
  ],
  revoke_knowledge_approval: [
    { name: 'missing fields', input: {}, reason: 'id+reason required' },
    { name: 'missing reason', input: { id: 1 }, reason: 'reason required' },
    { name: 'empty reason', input: { id: 1, reason: '' }, reason: 'reason min(1)' },
  ],
  reject_knowledge_candidate: [
    { name: 'missing fields', input: {}, reason: 'id+reason required' },
    { name: 'missing reason', input: { id: 1 }, reason: 'reason required' },
    { name: 'empty reason', input: { id: 1, reason: '' }, reason: 'reason min(1)' },
  ],
}

function isZodError(err: unknown): err is z.ZodError {
  return err instanceof z.ZodError
}

test('zod-negative: INVALID dictionary covers every registered tool', () => {
  for (const tool of TOOLS) {
    assert.ok(
      // biome-ignore lint/suspicious/noPrototypeBuiltins: safe call pattern
      Object.prototype.hasOwnProperty.call(INVALID, tool.name),
      `${tool.name} missing INVALID entry`,
    )
  }
})

test('zod-negative: INVALID dictionary has no orphan keys', () => {
  const toolNames = new Set(TOOLS.map(t => t.name))
  for (const key of Object.keys(INVALID)) {
    assert.ok(toolNames.has(key), `INVALID has orphan key ${key}`)
  }
})

test('zod-negative: per-tool invalid inputs throw ZodError', () => {
  for (const tool of TOOLS) {
    const cases = INVALID[tool.name] ?? []
    for (const c of cases) {
      let thrown: unknown
      try {
        tool.zodSchema.parse(c.input)
      } catch (e) {
        thrown = e
      }
      assert.ok(thrown !== undefined, `${tool.name} ["${c.name}"] (${c.reason}) must throw`)
      assert.ok(
        isZodError(thrown),
        `${tool.name} ["${c.name}"] expected ZodError, got ${(thrown as Error)?.constructor?.name}`,
      )
    }
  }
})

test('zod-negative: every tool rejects array input', () => {
  for (const tool of TOOLS) {
    assert.throws(() => tool.zodSchema.parse([]), z.ZodError, `${tool.name} must reject array`)
  }
})

test('zod-negative: every tool rejects null input', () => {
  for (const tool of TOOLS) {
    assert.throws(() => tool.zodSchema.parse(null), z.ZodError, `${tool.name} must reject null`)
  }
})

test('zod-negative: every tool rejects string input', () => {
  for (const tool of TOOLS) {
    assert.throws(
      () => tool.zodSchema.parse('not an object'),
      z.ZodError,
      `${tool.name} must reject string`,
    )
  }
})

test('zod-negative: every tool rejects number input', () => {
  for (const tool of TOOLS) {
    assert.throws(() => tool.zodSchema.parse(42), z.ZodError, `${tool.name} must reject number`)
  }
})

test('zod-negative: tools with required fields throw on empty object {}', () => {
  // These tools have only optional or defaulted fields — {} is a valid input.
  const allOptional = new Set([
    'verify_audit_integrity',
    'list_tasks',
    'tail_audit',
    'get_cost_summary',
    'check_budget',
    'get_knowledge_drafts',  // layer and limit are optional
  ])
  for (const tool of TOOLS) {
    if (allOptional.has(tool.name)) continue
    assert.throws(
      () => tool.zodSchema.parse({}),
      z.ZodError,
      `${tool.name} must throw on empty object (has required fields)`,
    )
  }
})

test('zod-negative: tools with all-optional fields accept {} (sanity check on the skip list)', () => {
  const allOptional = ['verify_audit_integrity', 'list_tasks', 'tail_audit', 'get_cost_summary', 'check_budget']
  for (const name of allOptional) {
    const tool = TOOLS.find(t => t.name === name)
    assert.ok(tool, `${name} must exist`)
    // Should not throw — this pins the contract that these accept {}.
    tool.zodSchema.parse({})
  }
})
