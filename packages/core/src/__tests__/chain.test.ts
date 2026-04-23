import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeContentHash, computeChainHash, getGenesisHash } from '../audit/chain.js'

test('computeContentHash: top-level key insertion order does not affect hash', () => {
  const a = computeContentHash({ x: 1, y: 2 })
  const b = computeContentHash({ y: 2, x: 1 })
  assert.equal(a, b)
})

// BUG: JSON.stringify(obj, ['event','meta']) drops nested keys not in top-level array
test('computeContentHash: nested keys with names absent from top-level keys are NOT dropped', () => {
  const withData = computeContentHash({ event: 'test', meta: { secret: 'x' } })
  const withEmpty = computeContentHash({ event: 'test', meta: {} })
  assert.notEqual(withData, withEmpty,
    'nested key "secret" must not be silently dropped by replacer array')
})

// BUG: deeply nested values are also dropped, so different values hash identically
test('computeContentHash: deeply nested values affect hash', () => {
  const a = computeContentHash({ data: { nested: { value: 42 } } })
  const b = computeContentHash({ data: { nested: { value: 99 } } })
  assert.notEqual(a, b, 'different deeply nested values must produce different hashes')
})

test('computeContentHash: nested key insertion order does not affect hash', () => {
  const a = computeContentHash({ meta: { z: 1, a: 2 } })
  const b = computeContentHash({ meta: { a: 2, z: 1 } })
  assert.equal(a, b, 'nested key order must not affect hash')
})

test('getGenesisHash returns 64-char hex zeros', () => {
  const genesis = getGenesisHash()
  assert.equal(genesis.length, 64)
  assert.equal(genesis, '0'.repeat(64))
})

test('computeChainHash: different inputs produce different hashes', () => {
  const h1 = computeChainHash('0'.repeat(64), 'abc')
  const h2 = computeChainHash('0'.repeat(64), 'xyz')
  assert.notEqual(h1, h2)
})

test('computeChainHash: output is deterministic', () => {
  const h1 = computeChainHash('a'.repeat(64), 'payload1')
  const h2 = computeChainHash('a'.repeat(64), 'payload1')
  assert.equal(h1, h2)
})
