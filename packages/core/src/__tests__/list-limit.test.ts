import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')

import { runMigrations, closeDb } from '../db/client.js'
import { createPlaybook, listPlaybooks } from '../playbook/service.js'
import { listKnowledge, createKnowledgeItem } from '../knowledge/retriever.js'
import { LIST_MAX_LIMIT } from '../lib/limits.js'

before(() => {
  runMigrations()
})

after(() => {
  closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
})

test(`listPlaybooks: limit is clamped to ${LIST_MAX_LIMIT}`, () => {
  for (let i = 0; i < 5; i++) {
    createPlaybook({ slug: `pb-${i}`, title: `pb ${i}`, content: 'x', tags: [] })
  }
  const rows = listPlaybooks({ limit: 9999 })
  assert.ok(rows.length <= LIST_MAX_LIMIT, 'must respect LIST_MAX_LIMIT')
  const rowsDefault = listPlaybooks({})
  assert.ok(rowsDefault.length <= LIST_MAX_LIMIT)
})

test('listKnowledge: explicit limit=2 returns at most 2', () => {
  for (let i = 0; i < 5; i++) {
    createKnowledgeItem({
      layer: 'global',
      title: `k-${i}`,
      content: `content-${i}`,
      tags: [],
    })
  }
  const rows = listKnowledge({ limit: 2 })
  assert.ok(rows.length <= 2)
})

test('listKnowledge: limit clamped to LIST_MAX_LIMIT even if caller passes Infinity-like', () => {
  const rows = listKnowledge({ limit: 10_000_000 })
  assert.ok(rows.length <= LIST_MAX_LIMIT)
})
