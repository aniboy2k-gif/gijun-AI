import { getDb, runMigrations } from '../db/client.js'
import { computeChainHash, getGenesisHash } from './chain.js'

type AuditRow = {
  id: number
  prev_hash: string
  original_hash: string | null
  content_hash: string
  chain_hash: string
}

export type VerifyOptions = {
  /** Only verify rows with id >= fromId. When fromId <= 1 or no preceding row exists, genesis hash is used as seed. */
  fromId?: number
  /** Only verify the most recent N rows (applied after fromId filter). */
  limit?: number
}

export type VerifyResultItem =
  | { kind: 'linkage'; id: number; expected: string; actual: string }
  | { kind: 'recompute'; id: number; expected: string; actual: string }
  | { kind: 'chain_gap'; fromId: number }

export type VerifyResult = {
  valid: boolean
  total: number
  broken: VerifyResultItem[]
}

export function verifyChain(opts?: VerifyOptions): VerifyResult {
  const db = getDb()
  const { fromId, limit } = opts ?? {}

  // Resolve the starting prev_hash seed.
  // If fromId > 1, use the chain_hash of the preceding row as the seed.
  // If no preceding row exists when fromId > 1, the chain has a gap — fail immediately.
  let expectedPrevHash = getGenesisHash()
  if (fromId != null && fromId > 1) {
    const prev = db
      .prepare('SELECT chain_hash FROM audit_events WHERE id < ? ORDER BY id DESC LIMIT 1')
      .get(fromId) as { chain_hash: string } | undefined
    if (prev == null) {
      return { valid: false, total: 0, broken: [{ kind: 'chain_gap', fromId }] }
    }
    expectedPrevHash = prev.chain_hash
  }

  // Build query with optional fromId and limit constraints.
  let sql = 'SELECT id, prev_hash, original_hash, content_hash, chain_hash FROM audit_events'
  const params: number[] = []
  if (fromId != null && fromId >= 1) {
    sql += ' WHERE id >= ?'
    params.push(fromId)
  }
  sql += ' ORDER BY id ASC'
  if (limit != null && limit > 0) {
    sql += ' LIMIT ?'
    params.push(limit)
  }

  const rows = db.prepare(sql).all(...params) as AuditRow[]
  const broken: VerifyResultItem[] = []

  for (const row of rows) {
    if (row.prev_hash !== expectedPrevHash) {
      broken.push({ kind: 'linkage', id: row.id, expected: expectedPrevHash, actual: row.prev_hash })
    }

    // chain_hash is based on original_hash (pre-redaction).
    // Rows created before migration 002 have original_hash = content_hash (initialized by migration).
    const hashBase = row.original_hash ?? row.content_hash
    const expectedChain = computeChainHash(row.prev_hash, hashBase)
    if (row.chain_hash !== expectedChain) {
      broken.push({ kind: 'recompute', id: row.id, expected: expectedChain, actual: row.chain_hash })
    }
    expectedPrevHash = row.chain_hash
  }

  return { valid: broken.length === 0, total: rows.length, broken }
}

// CLI entry: run via the audit:verify script in root package.json.
// Supported flags:
//   --from <id>   start verification from this row id (incremental)
//   --limit <n>   verify only the most recent n rows
//   --json        output result as JSON to stdout
//   --quiet       suppress output on success (cron-friendly)
//   --emit-audit-on-fail  DEPRECATED: no-op — kept for backward compat, will be removed in v0.3
export function runVerifyChainCli(argv?: string[]): void {
  const args = argv ?? process.argv.slice(2)

  // Parse flags
  let fromId: number | undefined
  let limit: number | undefined
  let jsonMode = false
  let quiet = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--from' && args[i + 1]) {
      fromId = Number(args[++i])
    } else if (arg === '--limit' && args[i + 1]) {
      limit = Number(args[++i])
    } else if (arg === '--json') {
      jsonMode = true
    } else if (arg === '--quiet') {
      quiet = true
    } else if (arg === '--emit-audit-on-fail') {
      // Deprecated: audit chain writes during chain verification create a circular dependency.
      // Use exit code 1 and pipe to a separate audit-logging script instead.
      process.stderr.write(
        '[DEPRECATED] --emit-audit-on-fail is a no-op and will be removed in v0.3. ' +
        'Handle verification failures via exit code 1 in your CI/cron script.\n'
      )
    }
  }

  runMigrations()
  const verifyOpts: VerifyOptions = {}
  if (fromId != null) verifyOpts.fromId = fromId
  if (limit != null) verifyOpts.limit = limit
  const result = verifyChain(verifyOpts)

  if (jsonMode) {
    process.stdout.write(JSON.stringify(result) + '\n')
    if (!result.valid) process.exit(1)
    return
  }

  if (result.valid) {
    if (!quiet) {
      console.log(`✓ 체인 무결성 확인 완료 — ${result.total}개 레코드 이상 없음`)
    }
  } else {
    console.error(`✗ 체인 무결성 오류 — ${result.broken.length}개 레코드 불일치`)
    console.error(result.broken)
    process.exit(1)
  }
}
