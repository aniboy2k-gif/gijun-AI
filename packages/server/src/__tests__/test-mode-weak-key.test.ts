// CSR #775 H-INT-3: HMAC_KEY weak-key brute-force resistance
// Internal review fix: AGENTGUARD_CONFIG_HMAC_KEY < 32 chars throws at module load.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Set short HMAC_KEY BEFORE module import — module-level check should throw
process.env['NODE_ENV'] = 'test'
process.env['AGENTGUARD_CONFIG_HMAC_KEY'] = 'short' // 5 chars, < 32 minimum

test('H-INT-3: test-mode.ts throws on HMAC_KEY < 32 chars at module load', async () => {
  await assert.rejects(
    async () => {
      await import('../auth/test-mode.js')
    },
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.match(
        (err as Error).message,
        /agentguard_config_hmac_key_too_short|256-bit entropy|at least 32 chars/i,
        'must throw weak-key error with descriptive message',
      )
      return true
    },
    'short HMAC_KEY (5 chars) must throw at module load',
  )
})
