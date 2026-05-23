#!/usr/bin/env node
// CSR #777 Phase 1: verify-failure-mode-consistency
//
// Reads docs/failure-mode-policy.md §2 ("Current Sentinels") and verifies:
//   (a) every documented sentinel has a matching `fail-mode: <tier>` marker in
//       its file AND all documented backtick keywords are present
//   (b) no `fail-mode:` marker exists in packages/*/src/ that is NOT registered
//   (c) no legacy `fail-closed` text marker exists outside a registered file
//   (d) `fail-mode-skip:` exemptions have a reason of ≥20 chars; the count is
//       reported in the summary (non-zero count requires PR acknowledgment).
//
// Exit codes:
//   0  — consistent
//   1  — inconsistency or schema parse failure
//
// Invoke: node scripts/verify-failure-mode-consistency.mjs
//         pnpm verify:failure-mode

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = dirname(dirname(__filename))
const POLICY_PATH = join(REPO_ROOT, 'docs/failure-mode-policy.md')
const SCAN_ROOTS = [
  join(REPO_ROOT, 'packages/server/src'),
  join(REPO_ROOT, 'packages/core/src'),
  join(REPO_ROOT, 'packages/mcp-server/src'),
]
const EXCLUDE_DIRS = new Set(['__tests__', 'node_modules', 'dist', 'dist-test', 'out', 'build', '__generated__'])

const MARKER_PATTERN = /fail-mode:\s*([ABC])\b/
const LEGACY_PATTERN = /fail[-_ ]?clos(?:ed|e)/i
const SKIP_PATTERN = /fail-mode-skip:\s*(.*)$/
const MIN_SKIP_REASON_CHARS = 20

function parsePolicyTable(md) {
  const section = md.split(/^## 2\. /m)[1]
  if (!section) throw new Error('Section "## 2." not found in policy doc')
  const tableBody = section.split(/^##\s/m)[0]
  const rows = []
  for (const line of tableBody.split('\n')) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*([ABC])\s*\|\s*`?([^`|]+?)`?\s*\|\s*([\d\-,\s]+?)\s*\|\s*(.+?)\s*\|/)
    if (!m) continue
    rows.push({
      num: parseInt(m[1], 10),
      tier: m[2],
      file: m[3].trim(),
      lineSpec: m[4].trim(),
      description: m[5].trim(),
    })
  }
  return rows
}

function extractKeywords(description) {
  const out = []
  const tickRe = /`([^`]+)`/g
  for (const m of description.matchAll(tickRe)) {
    out.push(m[1])
  }
  return out
}

function walk(dir, acc = []) {
  if (!statSync(dir, { throwIfNoEntry: false })) return acc
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) {
      walk(p, acc)
    } else if (st.isFile() && /\.(ts|mts|cts|js|mjs|cjs)$/.test(entry)) {
      acc.push(p)
    }
  }
  return acc
}

function findMarkers(content) {
  const out = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MARKER_PATTERN)
    if (m) out.push({ line: i + 1, tier: m[1], text: lines[i].trim() })
  }
  return out
}

function findLegacy(content) {
  const out = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (MARKER_PATTERN.test(lines[i])) continue
    if (LEGACY_PATTERN.test(lines[i])) out.push({ line: i + 1, text: lines[i].trim() })
  }
  return out
}

function findSkips(content) {
  const out = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SKIP_PATTERN)
    if (m) out.push({ line: i + 1, reason: m[1].trim() })
  }
  return out
}

function main() {
  const md = readFileSync(POLICY_PATH, 'utf8')
  const rows = parsePolicyTable(md)
  if (rows.length === 0) {
    console.error('[verify-failure-mode] FAIL: no rows parsed from policy table')
    process.exit(1)
  }

  let errors = 0
  let skipCount = 0
  const documentedFiles = new Map()
  for (const r of rows) {
    const abs = join(REPO_ROOT, r.file)
    if (!documentedFiles.has(abs)) documentedFiles.set(abs, [])
    documentedFiles.get(abs).push(r)
  }

  // (a) keyword + marker presence per row
  for (const row of rows) {
    const filePath = join(REPO_ROOT, row.file)
    let content
    try {
      content = readFileSync(filePath, 'utf8')
    } catch {
      console.error(`[verify-failure-mode] row #${row.num}: file not found: ${row.file}`)
      errors++
      continue
    }
    const keywords = extractKeywords(row.description)
    if (keywords.length === 0) {
      console.error(`[verify-failure-mode] row #${row.num}: no backtick keywords in description`)
      errors++
      continue
    }
    const missing = keywords.filter((kw) => !content.includes(kw))
    if (missing.length > 0) {
      console.error(`[verify-failure-mode] row #${row.num} (${row.file}): missing keyword(s): ${missing.map((s) => JSON.stringify(s)).join(', ')}`)
      errors++
    }
    const markers = findMarkers(content)
    const tierMatches = markers.filter((m) => m.tier === row.tier)
    if (tierMatches.length === 0) {
      console.error(`[verify-failure-mode] row #${row.num} (${row.file}): no \`fail-mode: ${row.tier}\` marker found in file`)
      errors++
    }
  }

  // (b)+(c) drift checks across all scanned files
  const allFiles = SCAN_ROOTS.flatMap((root) => walk(root))
  for (const f of allFiles) {
    const content = readFileSync(f, 'utf8')
    const isRegistered = documentedFiles.has(f)
    const markers = findMarkers(content)
    const legacy = findLegacy(content)
    const skips = findSkips(content)

    if (!isRegistered) {
      for (const m of markers) {
        console.error(`[verify-failure-mode] drift: ${relative(REPO_ROOT, f)}:${m.line} has \`fail-mode: ${m.tier}\` marker but file is not in policy §2`)
        console.error(`    line: ${m.text}`)
        errors++
      }
      for (const l of legacy) {
        console.error(`[verify-failure-mode] drift (legacy): ${relative(REPO_ROOT, f)}:${l.line} has fail-closed marker but file is not in policy §2`)
        console.error(`    line: ${l.text}`)
        errors++
      }
    }

    for (const s of skips) {
      skipCount++
      if (s.reason.length < MIN_SKIP_REASON_CHARS) {
        console.error(`[verify-failure-mode] skip-reason too short (<${MIN_SKIP_REASON_CHARS} chars): ${relative(REPO_ROOT, f)}:${s.line}: ${JSON.stringify(s.reason)}`)
        errors++
      }
    }
  }

  if (errors > 0) {
    console.error(`[verify-failure-mode] FAIL: ${errors} inconsistencies, ${skipCount} skip exemptions in ${allFiles.length} files`)
    process.exit(1)
  }
  console.log(`[verify-failure-mode] OK: ${rows.length} sentinels verified, ${skipCount} skip exemptions, no drift in ${allFiles.length} files`)
}

main()
