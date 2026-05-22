// CSR #775 P1 C2: AGENTGUARD_TEST_MODE HMAC Key Management
// Refs: CSR #771 R4 DeepSeek finding — NODE_ENV bypass via AGENTGUARD_ENV_FILE
// Plan v2: ~/workspace/gijun-ai/prompt_plan.md §P1

import crypto from 'node:crypto'

const HMAC_KEY = process.env['AGENTGUARD_CONFIG_HMAC_KEY']
const IS_PROD = process.env['NODE_ENV'] === 'production'
const BOOT_EPOCH = Date.now()
const MIN_HMAC_KEY_LENGTH = 32 // 256-bit entropy minimum (32 hex chars or 32 bytes raw)

if (!HMAC_KEY && IS_PROD) {
  throw new Error(
    'agentguard_config_hmac_key_required_in_production: ' +
      'AGENTGUARD_CONFIG_HMAC_KEY env var must be set when NODE_ENV=production. ' +
      'See docs/migration-CSR-775.md for setup.'
  )
}

// H-INT-3 (Internal review fix): weak-key brute-force resistance.
// Reject HMAC_KEY shorter than 32 chars at module load to prevent ~24-bit entropy keys.
if (HMAC_KEY && HMAC_KEY.length < MIN_HMAC_KEY_LENGTH) {
  throw new Error(
    `agentguard_config_hmac_key_too_short: ` +
      `AGENTGUARD_CONFIG_HMAC_KEY must be at least ${MIN_HMAC_KEY_LENGTH} chars ` +
      `(256-bit entropy). Got ${HMAC_KEY.length} chars. ` +
      `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  )
}

interface TestModePayload {
  epoch: number
  ttl: number
}

export function getBootEpoch(): number {
  return BOOT_EPOCH
}

export function generateTestMode(ttlMs: number): string {
  if (!HMAC_KEY) {
    throw new Error('agentguard_config_hmac_key_not_set: cannot generate token')
  }
  const payload = Buffer.from(
    JSON.stringify({ epoch: BOOT_EPOCH, ttl: ttlMs } satisfies TestModePayload)
  ).toString('base64')
  const signature = crypto
    .createHmac('sha256', HMAC_KEY)
    .update(payload)
    .digest('hex')
  return `${payload}.${signature}`
}

export function validTestMode(token: string | undefined): boolean {
  if (!token || !HMAC_KEY) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [payload, signature] = parts
  if (!payload || !signature) return false

  let parsed: TestModePayload
  try {
    parsed = JSON.parse(
      Buffer.from(payload, 'base64').toString('utf-8')
    ) as TestModePayload
  } catch {
    return false
  }

  if (typeof parsed.epoch !== 'number' || typeof parsed.ttl !== 'number') {
    return false
  }
  if (parsed.epoch !== BOOT_EPOCH) return false // anti-replay
  if (parsed.ttl < Date.now()) return false // TTL expired

  const expected = crypto
    .createHmac('sha256', HMAC_KEY)
    .update(payload)
    .digest('hex')

  // Length check before timingSafeEqual (avoid RangeError)
  if (signature.length !== expected.length) return false

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'utf-8'),
      Buffer.from(expected, 'utf-8')
    )
  } catch {
    return false
  }
}
