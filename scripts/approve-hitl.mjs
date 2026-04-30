#!/usr/bin/env node
// Human-only HITL approval helper.
// Usage: node scripts/approve-hitl.mjs <task-id>
//
// Intentionally kept out of MCP tools so agents cannot call it automatically.
// Env: AGENTGUARD_TOKEN, AGENTGUARD_HOST (default: http://localhost:3456)

import { createInterface } from 'node:readline'

const [,, rawId] = process.argv
const id = parseInt(rawId, 10)

if (!rawId || Number.isNaN(id) || id < 1) {
  console.error('Usage: node scripts/approve-hitl.mjs <task-id>')
  process.exit(1)
}

const token = process.env['AGENTGUARD_TOKEN']
if (!token) {
  console.error('approve-hitl: AGENTGUARD_TOKEN not set')
  process.exit(1)
}

const host = process.env['AGENTGUARD_HOST'] ?? 'http://localhost:3456'

// Confirm before approving
const rl = createInterface({ input: process.stdin, output: process.stdout })
rl.question(`Approve HITL gate for task #${id}? [y/N] `, async (answer) => {
  rl.close()
  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted.')
    process.exit(0)
  }

  const res = await fetch(`${host}/tasks/${id}/hitl-approve`, {
    method: 'POST',
    headers: { 'X-AgentGuard-Token': token },
  })

  if (res.ok) {
    console.log(`✓ Task #${id} HITL approved`)
  } else {
    const body = await res.text().catch(() => '')
    console.error(`✗ Failed (${res.status}): ${body}`)
    process.exit(1)
  }
})
