import { createHash } from 'node:crypto'

const GENESIS_HASH = '0'.repeat(64)

export function computeContentHash(fields: Record<string, unknown>): string {
  const serialized = JSON.stringify(fields, Object.keys(fields).sort())
  return createHash('sha256').update(serialized).digest('hex')
}

export function computeChainHash(prevHash: string, contentHash: string): string {
  return createHash('sha256').update(prevHash + contentHash).digest('hex')
}

export function getGenesisHash(): string {
  return GENESIS_HASH
}
