import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db

  const dbPath = process.env['GIJUN_DB_PATH'] ?? join(process.cwd(), 'gijun.db')
  _db = new DatabaseSync(dbPath)

  _db.exec('PRAGMA journal_mode=WAL')
  _db.exec('PRAGMA foreign_keys=ON')
  _db.exec('PRAGMA busy_timeout=5000')

  return _db
}

export function runMigrations(): void {
  const db = getDb()

  const alreadyMigrated = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
    .get()

  if (alreadyMigrated) return

  const migrationPath = join(process.cwd(), 'migrations', '001_initial.sql')
  const sql = readFileSync(migrationPath, 'utf-8')
  db.exec(sql)
}

export function closeDb(): void {
  _db?.close()
  _db = null
}
