import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

test('migrations-chain: every .sql file under migrations/ has a matching server.ts assertSchemaChain entry', () => {
  const migrationsDir = resolve(__dirname, '../../../../migrations')
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
  const versions = files.map(f => f.replace(/\.sql$/, ''))

  const serverTs = resolve(__dirname, '../../../server/src/server.ts')
  const fs = require('node:fs') as typeof import('node:fs')
  const src = fs.readFileSync(serverTs, 'utf8')

  // Extract array literal body of assertSchemaChain([...]).
  const m = src.match(/assertSchemaChain\s*\(\s*\[([^\]]+)\]/)
  assert.ok(m, 'assertSchemaChain call must exist in server.ts')
  const chainVersions = (m[1] ?? '')
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .sort()

  assert.deepEqual(
    chainVersions,
    versions,
    `assertSchemaChain versions must match migrations/*.sql files.\n  files: ${JSON.stringify(versions)}\n  chain: ${JSON.stringify(chainVersions)}`,
  )
})
