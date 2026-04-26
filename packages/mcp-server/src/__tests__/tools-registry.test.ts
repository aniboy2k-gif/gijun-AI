import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { TOOLS, findTool } from '../tools.js'

// Naming policy from tools.ts module header.
const WRITE_PREFIXES = ['create_', 'update_', 'add_', 'append_', 'promote_', 'approve_', 'report_']
const READ_PREFIXES = ['get_', 'list_', 'search_', 'tail_', 'verify_', 'check_', 'preflight_']

function classify(name: string): 'read' | 'write' | 'unknown' {
  if (WRITE_PREFIXES.some(p => name.startsWith(p))) return 'write'
  if (READ_PREFIXES.some(p => name.startsWith(p))) return 'read'
  return 'unknown'
}

test('tools-registry: TOOLS length is exactly 17 (READ 9 + WRITE 8)', () => {
  assert.equal(TOOLS.length, 17)
})

test('tools-registry: every tool name is unique', () => {
  const names = TOOLS.map(t => t.name)
  assert.equal(new Set(names).size, TOOLS.length)
})

test('tools-registry: every tool name matches snake_case pattern', () => {
  const pattern = /^[a-z][a-z0-9_]*$/
  for (const tool of TOOLS) {
    assert.match(tool.name, pattern, `tool ${tool.name} must match ^[a-z][a-z0-9_]*$`)
  }
})

test('tools-registry: every tool has a zodSchema (instanceof z.ZodType)', () => {
  for (const tool of TOOLS) {
    assert.ok(tool.zodSchema instanceof z.ZodType, `${tool.name} zodSchema must be z.ZodType`)
  }
})

test('tools-registry: every tool has a non-null inputSchema object', () => {
  for (const tool of TOOLS) {
    assert.equal(typeof tool.inputSchema, 'object', `${tool.name} inputSchema must be object`)
    assert.ok(tool.inputSchema !== null, `${tool.name} inputSchema must not be null`)
  }
})

test('tools-registry: every tool handler is a function', () => {
  for (const tool of TOOLS) {
    assert.equal(typeof tool.handler, 'function', `${tool.name} handler must be function`)
  }
})

test('tools-registry: every tool description starts with a capital letter', () => {
  for (const tool of TOOLS) {
    const first = tool.description.charAt(0)
    assert.match(first, /[A-Z]/, `${tool.name} description must start with capital letter`)
  }
})

test('tools-registry: every tool name classifies as either read or write (no unknown)', () => {
  for (const tool of TOOLS) {
    const kind = classify(tool.name)
    assert.notEqual(kind, 'unknown', `tool ${tool.name} must use a documented prefix`)
  }
})

test('tools-registry: 9 READ tools and 8 WRITE tools by prefix policy', () => {
  const reads = TOOLS.filter(t => classify(t.name) === 'read')
  const writes = TOOLS.filter(t => classify(t.name) === 'write')
  assert.equal(reads.length, 9, '9 READ tools expected')
  assert.equal(writes.length, 8, '8 WRITE tools expected')
})

test('tools-registry: every WRITE tool description contains "WRITES"', () => {
  // WRITE side-effect must be self-documented for caller awareness.
  const writes = TOOLS.filter(t => classify(t.name) === 'write')
  for (const tool of writes) {
    assert.ok(
      tool.description.includes('WRITES'),
      `WRITE tool ${tool.name} description must contain "WRITES"`,
    )
  }
})

test('tools-registry: no READ tool description claims "WRITES"', () => {
  // READ tools must not falsely advertise side effects.
  const reads = TOOLS.filter(t => classify(t.name) === 'read')
  for (const tool of reads) {
    assert.ok(
      !tool.description.includes('WRITES'),
      `READ tool ${tool.name} description must not contain "WRITES"`,
    )
  }
})

test('tools-registry: findTool returns the same reference for an existing name', () => {
  const sample = TOOLS[0]
  assert.ok(sample, 'TOOLS must not be empty')
  assert.equal(findTool(sample.name), sample)
})

test('tools-registry: findTool returns undefined for a non-existent name', () => {
  assert.equal(findTool('nonexistent_tool_xyz_123'), undefined)
})
