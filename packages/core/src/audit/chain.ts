import { createHash } from 'node:crypto'

// MUST match the audit_events.prev_hash DEFAULT in migrations/001_initial.sql
// (64 zero hex digits — SHA-256 sentinel for the chain's first row).
// SQL cannot import this constant; runMigrations() validates the schema chain
// at startup but the literal value is duplicated by necessity. See also
// the schema_metadata table proposed in v0.2 (final.txt H5중기).
const GENESIS_HASH = '0'.repeat(64)

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + (value as unknown[]).map(canonicalJson).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const sortedKeys = Object.keys(obj).sort()
  const pairs = sortedKeys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
  return '{' + pairs.join(',') + '}'
}

/** Hash of arbitrary fields — used for both originalHash and contentHash. */
export function computeContentHash(fields: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(fields)).digest('hex')
}

/**
 * chain_hash = SHA256(prevHash + originalHash).
 * originalHash must be computed from the unredacted payload so that
 * redaction policy changes do not invalidate the chain.
 */
export function computeChainHash(prevHash: string, originalHash: string): string {
  return createHash('sha256').update(prevHash + originalHash).digest('hex')
}

export function getGenesisHash(): string {
  return GENESIS_HASH
}
