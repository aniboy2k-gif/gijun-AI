import { z } from 'zod'

const IRREVERSIBLE_PATTERNS = [
  'DROP TABLE',
  'DROP DATABASE',
  'rm -rf',
  'git push --force',
  'DELETE FROM',
  'TRUNCATE',
  'format(',
  'mkfs.',
]

export const ActionContextSchema = z.object({
  action: z.string(),
  complexity: z.enum(['trivial', 'standard', 'complex', 'critical']).optional(),
  blastRadius: z.enum(['local', 'project', 'external']).optional(),
  verifyConfidence: z.number().min(0).max(1).optional(),
  verifyVerdict: z.enum(['pass', 'fail', 'partial']).optional(),
})

export type ActionContext = z.infer<typeof ActionContextSchema>

export type HitlTrigger =
  | { reason: 'irreversible'; pattern: string }
  | { reason: 'blast_radius'; scope: 'external' }
  | { reason: 'complexity'; level: 'critical' }
  | { reason: 'verify_fail'; verdict: string }
  | { reason: 'low_confidence'; confidence: number }

export function evaluateHitl(ctx: ActionContext): HitlTrigger | null {
  const matched = IRREVERSIBLE_PATTERNS.find(p => ctx.action.toUpperCase().includes(p.toUpperCase()))
  if (matched) return { reason: 'irreversible', pattern: matched }

  if (ctx.blastRadius === 'external') return { reason: 'blast_radius', scope: 'external' }
  if (ctx.complexity === 'critical') return { reason: 'complexity', level: 'critical' }
  if (ctx.verifyVerdict === 'fail') return { reason: 'verify_fail', verdict: ctx.verifyVerdict }
  if (ctx.verifyConfidence !== undefined && ctx.verifyConfidence < 0.7) {
    return { reason: 'low_confidence', confidence: ctx.verifyConfidence }
  }

  return null
}

export function describeHitlTrigger(trigger: HitlTrigger): string {
  switch (trigger.reason) {
    case 'irreversible': return `비가역 액션 감지: "${trigger.pattern}"`
    case 'blast_radius': return `외부 시스템 영향 범위`
    case 'complexity': return `복잡도 critical 작업`
    case 'verify_fail': return `검증 실패 (verdict=${trigger.verdict})`
    case 'low_confidence': return `검증 신뢰도 낮음 (${(trigger.confidence * 100).toFixed(0)}%)`
  }
}
