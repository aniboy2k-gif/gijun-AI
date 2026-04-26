#!/usr/bin/env node
// Drift gate: ensure docs/audit-event-schema.md §1 column table matches
// the actual schema after applying all migrations/*.sql.
//
// Why a separate script: relying on humans to remember to update the doc
// when a migration lands is unreliable. CI runs this on every PR.
//
// Exit 0 = in sync. Exit 1 = drift detected, with a unified-diff style report.

import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

const MIGRATIONS_DIR = join(repoRoot, 'migrations')
const DOC_PATH = join(repoRoot, 'docs', 'audit-event-schema.md')
const TABLE = 'audit_events'
const MARKER_START = '<!-- generated:audit-events-columns:start -->'
const MARKER_END = '<!-- generated:audit-events-columns:end -->'

function fail(msg) {
  console.error(`✗ verify-audit-schema: ${msg}`)
  process.exit(1)
}

// 1) Apply all migrations to an in-memory DB and read the live column shape.
function readLiveColumns() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
    try {
      db.exec(sql)
    } catch (e) {
      fail(`failed to apply ${file}: ${String(e)}`)
    }
  }

  const rows = db.prepare(`PRAGMA table_info(${TABLE})`).all()
  db.close()
  if (rows.length === 0) fail(`table ${TABLE} not found after applying migrations`)
  return rows.map(r => ({
    cid: Number(r.cid),
    name: String(r.name),
    type: String(r.type),
    notnull: Number(r.notnull),
    // SQLite returns defaults with surrounding quotes for literal values
    // (e.g. "'ai'"). Strip them so comparison with the doc is symmetric.
    dflt_value: stripQuotes(r.dflt_value === null ? '' : String(r.dflt_value)),
    pk: Number(r.pk),
  }))
}

// 2) Parse the documented columns from the marker block.
function readDocColumns() {
  const md = readFileSync(DOC_PATH, 'utf-8')
  const startIdx = md.indexOf(MARKER_START)
  const endIdx = md.indexOf(MARKER_END)
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    fail(`marker block missing or malformed in ${DOC_PATH}`)
  }
  const block = md.slice(startIdx + MARKER_START.length, endIdx).trim()
  // Skip header rows (header line + separator line).
  const lines = block.split('\n').filter(l => l.trim().startsWith('|'))
  const dataLines = lines.slice(2)

  return dataLines.map(line => {
    const cells = line.split('|').slice(1, -1).map(s => s.trim())
    if (cells.length < 6) fail(`expected 6 columns in row: "${line}"`)
    const [cid, name, type, notnull, dflt_value, pk] = cells
    return {
      cid: Number(cid),
      name,
      type,
      notnull: Number(notnull),
      // Strip wrapping single quotes that the doc uses for SQL literal defaults.
      dflt_value: stripQuotes(dflt_value),
      pk: Number(pk),
    }
  })
}

function stripQuotes(s) {
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1)
  return s
}

function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim()
}

// 3) Diff and report.
function diff(live, doc) {
  const errors = []
  if (live.length !== doc.length) {
    errors.push(`column count: live=${live.length}, doc=${doc.length}`)
  }
  const max = Math.max(live.length, doc.length)
  for (let i = 0; i < max; i++) {
    const l = live[i]
    const d = doc[i]
    if (!l) {
      errors.push(`row ${i}: present in doc only — ${d?.name}`)
      continue
    }
    if (!d) {
      errors.push(`row ${i}: present in live only — ${l.name}`)
      continue
    }
    if (l.cid !== d.cid) errors.push(`row ${i} (${l.name}): cid live=${l.cid} doc=${d.cid}`)
    if (l.name !== d.name) errors.push(`row ${i}: name live=${l.name} doc=${d.name}`)
    if (l.type !== d.type) errors.push(`row ${i} (${l.name}): type live=${l.type} doc=${d.type}`)
    if (l.notnull !== d.notnull) errors.push(`row ${i} (${l.name}): notnull live=${l.notnull} doc=${d.notnull}`)
    if (l.pk !== d.pk) errors.push(`row ${i} (${l.name}): pk live=${l.pk} doc=${d.pk}`)
    if (normalizeWhitespace(l.dflt_value) !== normalizeWhitespace(d.dflt_value)) {
      errors.push(
        `row ${i} (${l.name}): dflt_value live=<${l.dflt_value}> doc=<${d.dflt_value}>`,
      )
    }
  }
  return errors
}

const live = readLiveColumns()
const doc = readDocColumns()
const errors = diff(live, doc)

if (errors.length > 0) {
  console.error(`✗ verify-audit-schema: ${errors.length} mismatch(es) between migrations and docs/audit-event-schema.md`)
  for (const e of errors) console.error(`  - ${e}`)
  console.error('\nLive schema (after applying all migrations):')
  console.table(live)
  console.error('Update docs/audit-event-schema.md §1 column table to match.')
  process.exit(1)
}

console.log(`✓ verify-audit-schema: docs/audit-event-schema.md is in sync (${live.length} columns)`)
