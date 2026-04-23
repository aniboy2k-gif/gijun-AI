import { runMigrations, assertSchemaChain, closeDb } from '@gijun-ai/core'
import { createApp } from './app.js'

// fail-closed: token must be set before any request can succeed
if (!process.env['AGENTGUARD_TOKEN']) {
  console.error('[agentguard] FATAL: AGENTGUARD_TOKEN is not set.')
  console.error('  Run: source .env.agentguard   (or: npx agentguard init)')
  process.exit(1)
}

const PORT = parseInt(process.env['AGENTGUARD_PORT'] ?? '3456', 10)
const HOST = '127.0.0.1'  // local-only by design (contract #5)

runMigrations()

// Verify full migration chain before accepting requests (contract #2).
assertSchemaChain(['001_initial', '002_original_hash', '003_original_hash_type', '004_cost_budget', '005_policy_eval_index'])

process.on('exit', () => closeDb())

const app = createApp()
app.listen(PORT, HOST, () => {
  console.log(`[agentguard] server listening on http://${HOST}:${PORT}`)
})
