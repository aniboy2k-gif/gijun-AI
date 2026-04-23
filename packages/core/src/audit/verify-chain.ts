import { getDb, runMigrations } from '../db/client.js'
import { computeChainHash, getGenesisHash } from './chain.js'

type AuditRow = {
  id: number
  prev_hash: string
  original_hash: string | null
  content_hash: string
  chain_hash: string
}

export type VerifyResult = {
  valid: boolean
  total: number
  broken: Array<{ id: number; expected: string; actual: string }>
}

export function verifyChain(): VerifyResult {
  const rows = getDb()
    .prepare('SELECT id, prev_hash, original_hash, content_hash, chain_hash FROM audit_events ORDER BY id ASC')
    .all() as AuditRow[]

  const broken: VerifyResult['broken'] = []
  let expectedPrevHash = getGenesisHash()

  for (const row of rows) {
    if (row.prev_hash !== expectedPrevHash) {
      broken.push({ id: row.id, expected: expectedPrevHash, actual: row.prev_hash })
    }

    // chain_hash is based on original_hash (pre-redaction).
    // Rows created before migration 002 have original_hash = content_hash (initialized by migration).
    const hashBase = row.original_hash ?? row.content_hash
    const expectedChain = computeChainHash(row.prev_hash, hashBase)
    if (row.chain_hash !== expectedChain) {
      broken.push({ id: row.id, expected: expectedChain, actual: row.chain_hash })
    }
    expectedPrevHash = row.chain_hash
  }

  return { valid: broken.length === 0, total: rows.length, broken }
}

// CLI entry: run via the audit:verify script in root package.json
export function runVerifyChainCli(): void {
  runMigrations()
  const result = verifyChain()
  if (result.valid) {
    console.log(`✓ 체인 무결성 확인 완료 — ${result.total}개 레코드 이상 없음`)
  } else {
    console.error(`✗ 체인 무결성 오류 — ${result.broken.length}개 레코드 불일치`)
    console.error(result.broken)
    process.exit(1)
  }
}
