import { runMigrations, assertSchemaChain, closeDb } from '@gijun-ai/core'
import { createApp } from './app.js'
import { sweepTmpFiles } from './auth/env-file.js'
import { assertSingleInstance } from './auth/cluster-guard.js'
import { applyAppendOnlyFlagAtBoot } from './audit/append-only-flag.js'

// CSR #775 P4 M6: fail-closed cluster/worker_threads/forked child detection.
// Token holder's rotateInFlight boolean mutex is process-local; cluster mode
// or worker_threads break the invariant. Refuse to boot in unsafe topology.
assertSingleInstance()

// fail-closed: token must be set before any request can succeed
if (!process.env['AGENTGUARD_TOKEN']) {
  console.error('[agentguard] FATAL: AGENTGUARD_TOKEN is not set.')
  console.error('  Run: source .env.agentguard   (or: npx agentguard init)')
  process.exit(1)
}

const PORT = parseInt(process.env['AGENTGUARD_PORT'] ?? '3456', 10)
const HOST = '127.0.0.1'  // local-only by design (contract #5)

// H3: sweep any leftover .env.local.tmp.* from a prior crash mid-rotation.
try {
  const swept = sweepTmpFiles()
  if (swept > 0) {
    console.warn(`[agentguard] swept ${swept} stale .env.local.tmp.* file(s)`)
  }
} catch {
  // best-effort
}

runMigrations()

// Verify full migration chain before accepting requests (contract #2).
assertSchemaChain(['001_initial', '002_original_hash', '003_original_hash_type', '004_cost_budget', '005_policy_eval_index', '006_cost_parse_status', '007_knowledge_status', '008_external_sync'])

// CSR #775 P7 H3: apply OS append-only flag to audit DB file (production fail-closed).
// Skip when DB path is :memory: (test mode) or unset (cannot resolve default reliably).
const auditDbPath = process.env['GIJUN_DB_PATH']
if (auditDbPath && auditDbPath !== ':memory:') {
  applyAppendOnlyFlagAtBoot(auditDbPath)
}

process.on('exit', () => closeDb())

const app = createApp()
app.listen(PORT, HOST, () => {
  console.log(`[agentguard] server listening on http://${HOST}:${PORT}`)
})
