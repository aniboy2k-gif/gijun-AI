import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db

  // Support both AGENTGUARD_* (current) and GIJUN_* (legacy) env var names.
  const dbPath = process.env['AGENTGUARD_DB_PATH']
    ?? process.env['GIJUN_DB_PATH']
    ?? join(process.cwd(), '.agentguard', 'agentguard.db')
  _db = new DatabaseSync(dbPath)

  _db.exec('PRAGMA journal_mode=WAL')
  _db.exec('PRAGMA foreign_keys=ON')
  _db.exec('PRAGMA busy_timeout=5000')

  return _db
}

/** Verify that all required migrations have been applied. Exits the process if any are missing. */
export function assertSchemaChain(requiredVersions: string[]): void {
  const db = getDb()
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[])
      .map(r => r.version),
  )
  for (const v of requiredVersions) {
    if (!applied.has(v)) {
      console.error(`[agentguard] Missing required migration: ${v}. Re-run: npx agentguard init`)
      closeDb()
      process.exit(1)
    }
  }
}

export function runMigrations(): void {
  const db = getDb()
  const migrationsDir = process.env['AGENTGUARD_MIGRATIONS_PATH']
    ?? process.env['GIJUN_MIGRATIONS_PATH']
    ?? join(process.cwd(), 'migrations')

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  let files: string[]
  try {
    files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort()
  } catch {
    return
  }

  for (const file of files) {
    const version = file.replace('.sql', '')
    const already = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version)
    if (already) continue

    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        version,
        new Date().toISOString(),
      )
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${version} failed: ${String(e)}`)
    }
  }
}

export function closeDb(): void {
  try {
    _db?.close()
  } finally {
    _db = null
  }
}
