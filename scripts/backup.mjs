#!/usr/bin/env node
// Backup gijun.db using SQLite VACUUM INTO (safe online backup, WAL-aware).
// Creates a date-stamped copy and a chain_hash checkpoint for integrity spot-checks.
//
// Usage:  node scripts/backup.mjs [--keep N] [--dest DIR]
//   --keep N   Keep the N most recent backup files (default: 7). Older ones are pruned.
//   --dest DIR Directory to write backups into    (default: ./backups)
//
// Env:
//   AGENTGUARD_DB_PATH | GIJUN_DB_PATH   Path to gijun.db (fallback: ./gijun.db)
//   DB resolution order: AGENTGUARD_DB_PATH → GIJUN_DB_PATH → ./gijun.db
//
// Outputs (per run):
//   {dest}/gijun-backup-YYYY-MM-DD.db      — consistent SQLite snapshot (overwritten if same day)
//   {dest}/gijun-chain-checkpoint.json     — last 50 chain_hash entries for integrity spot-checks
//
// Restore: copy gijun-backup-YYYY-MM-DD.db to the original DB path.
//   Verify chain integrity after restore: pnpm audit:verify
//
// Note: scheduling (e.g. daily cron) is the operator's responsibility.
//   Cron example: 0 2 * * *  cd /path/to/gijun-ai && /usr/local/bin/node scripts/backup.mjs

import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const keepIdx  = args.indexOf('--keep')
const destIdx  = args.indexOf('--dest')
const keepFiles = keepIdx >= 0 ? parseInt(args[keepIdx + 1], 10) : 7
const destDir   = destIdx >= 0 ? args[destIdx + 1] : './backups'

if (Number.isNaN(keepFiles) || keepFiles < 1) {
  console.error('backup: --keep must be a positive integer')
  process.exit(1)
}

// ── DB path ─────────────────────────────────────────────────────────────────
const dbPath = process.env['AGENTGUARD_DB_PATH']
  ?? process.env['GIJUN_DB_PATH']
  ?? './gijun.db'

if (!existsSync(dbPath)) {
  console.error(`backup: DB not found at ${resolve(dbPath)}`)
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })

// ── 1. Online backup via VACUUM INTO ────────────────────────────────────────
// VACUUM INTO is WAL-aware and produces a consistent single-file snapshot
// without requiring an exclusive lock on the source database.
const today    = new Date().toISOString().slice(0, 10)
const destFile = join(destDir, `gijun-backup-${today}.db`)

const db = new DatabaseSync(dbPath)
try {
  db.exec(`VACUUM INTO '${destFile.replace(/'/g, "''")}'`)
  console.log(`✓ backup: ${destFile}`)
} finally {
  db.close()
}

// ── 2. chain_hash checkpoint ─────────────────────────────────────────────────
// Reads from the freshly-created backup (not the live DB) to avoid contention.
const backupDb = new DatabaseSync(destFile)
let hashes
try {
  hashes = backupDb.prepare(
    'SELECT id, chain_hash, created_at FROM audit_events ORDER BY id DESC LIMIT 50'
  ).all()
} catch {
  hashes = []
  console.warn('backup: audit_events table not found — checkpoint skipped (DB may be uninitialized)')
} finally {
  backupDb.close()
}

const checkpointFile = join(destDir, 'gijun-chain-checkpoint.json')
writeFileSync(
  checkpointFile,
  JSON.stringify({ updatedAt: new Date().toISOString(), source: destFile, hashes }, null, 2)
)
console.log(`✓ checkpoint: ${checkpointFile} (${hashes.length} entries)`)

// ── 3. Prune old backups ─────────────────────────────────────────────────────
const BACKUP_RE = /^gijun-backup-\d{4}-\d{2}-\d{2}\.db$/
const allBackups = readdirSync(destDir)
  .filter(f => BACKUP_RE.test(f))
  .sort()  // lexicographic = chronological for YYYY-MM-DD

const excess = allBackups.slice(0, Math.max(0, allBackups.length - keepFiles))
for (const f of excess) {
  try {
    unlinkSync(join(destDir, f))
    console.log(`✓ pruned: ${f}`)
  } catch (err) {
    console.warn(`backup: failed to prune ${f}: ${err.message}`)
  }
}

console.log(
  `backup complete — kept=${Math.min(allBackups.length, keepFiles)} pruned=${excess.length}`
)
