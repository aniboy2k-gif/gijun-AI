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

export function shouldVerify(complexity: Complexity): boolean {
  const rate = SAMPLING_RATE[complexity]
  if (rate === 0) return false
  if (rate === 1) return true
  return Math.random() < rate
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
