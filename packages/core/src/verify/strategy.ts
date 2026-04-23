import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getDb } from '../db/client.js'

export type Complexity = 'trivial' | 'standard' | 'complex' | 'critical'
export type VerifyMode = 'skip' | 'single' | 'peer' | 'da_loop'

const SAMPLING_RATE: Record<Complexity, number> = {
  trivial: 0,
  standard: 0.2,
  complex: 1.0,
  critical: 1.0,
}

const VERIFY_MODE: Record<Complexity, VerifyMode> = {
  trivial: 'skip',
  standard: 'single',
  complex: 'peer',
  critical: 'da_loop',
}

export const VerificationSchema = z.object({
  taskId: z.number().int().optional(),
  complexity: z.enum(['trivial', 'standard', 'complex', 'critical']),
  modelReviewer: z.string().optional(),
  verdict: z.enum(['pass', 'fail', 'partial']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  findings: z.array(z.string()).default([]),
})

export type VerificationInput = z.input<typeof VerificationSchema>

// Deterministic sampling: same taskId always yields the same verify decision.
// Uses AGENTGUARD_VERIFY_SEED to allow per-deployment tuning without code change.
const VERIFY_SEED = process.env.AGENTGUARD_VERIFY_SEED ?? 'agentguard-verify-seed-v1'

/**
 * Returns true when the task should be verified.
 * CONTRACT: callers must treat `false` as "skip verification" — do NOT proceed
 * with unverified output for complex/critical tasks when shouldVerify returns false
 * due to missing taskId; log the skip and route through manual review instead.
 */
export function shouldVerify(complexity: Complexity, taskId?: number): boolean {
  const rate = SAMPLING_RATE[complexity]
  if (rate === 0) return false
  if (rate === 1) return true
  if (taskId === undefined) {
    // taskId is required for deterministic sampling. Calling without it is a bug
    // or a sign of an adversarial call — skip verification and warn.
    console.warn('[agentguard] shouldVerify called without taskId — verification skipped')
    return false
  }
  const hex = createHash('sha256').update(`${taskId}:${VERIFY_SEED}`).digest('hex')
  return parseInt(hex.slice(0, 8), 16) % 100 < rate * 100
}

export function getVerifyMode(complexity: Complexity): VerifyMode {
  return VERIFY_MODE[complexity]
}

export function recordVerification(input: VerificationInput): number {
  const validated = VerificationSchema.parse(input)
  const mode = getVerifyMode(validated.complexity)

  const result = getDb().prepare(`
    INSERT INTO verifications (task_id, complexity, mode, model_reviewer, verdict, confidence, findings)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    validated.taskId ?? null,
    validated.complexity,
    mode,
    validated.modelReviewer ?? null,
    validated.verdict ?? null,
    validated.confidence ?? null,
    JSON.stringify(validated.findings),
  )

  return result.lastInsertRowid as number
}
