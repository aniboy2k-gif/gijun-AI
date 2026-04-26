import { z } from 'zod'
import { HITL_RULE_VERSION } from '../lib/limits.js'

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

/**
 * Step-level HITL evaluation. Returns the first matching trigger or null.
 *
 * Five reasons (kept distinct in the return type so callers can branch on
 * trigger.reason): irreversible, blast_radius, complexity, verify_fail,
 * low_confidence. The README/CHANGELOG abbreviation "4-axis" refers to the
 * underlying axes (irreversibility, blast radius, complexity, verification),
 * with low_confidence as a verification sub-case.
 */
export function evaluateStepHitl(ctx: ActionContext): HitlTrigger | null {
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

/**
 * @deprecated since v0.1.3 — use {@link evaluateStepHitl}. Kept for
 * backwards compatibility; will be removed in v0.2 or v1.0. The two
 * functions are byte-equivalent today; the rename clarifies that this
 * is *step-level* evaluation, distinct from {@link evaluateTaskHitl}.
 */
export function evaluateHitl(ctx: ActionContext): HitlTrigger | null {
  return evaluateStepHitl(ctx)
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

// ============================================================
// Task-level HITL evaluation (C1)
// ============================================================

export type TaskHitlInput = {
  complexity: 'trivial' | 'standard' | 'complex' | 'critical'
  toolName?: string
  actionType?: 'read' | 'write' | 'execute' | 'delete'
  resource?: string
}

export type TaskHitlDecision = {
  hitlRequired: boolean
  trigger: TaskHitlTriggerPayload
}

type TaskHitlAxis =
  | 'critical_complexity'
  | 'complex_complexity'
  | 'incomplete_context'
  | 'strict_mode_downgraded'

export type TaskHitlTriggerPayload = {
  ruleVersion: typeof HITL_RULE_VERSION
  evaluator: 'hitl-gate-v1'
  evaluatedAt: string
  axes: TaskHitlAxis[]
  inputs: {
    complexity: TaskHitlInput['complexity']
    toolName: string | null
    actionType: TaskHitlInput['actionType'] | null
    resource: string | null
  }
  mode: 'full' | 'complexity-only'
  strictMode: boolean
}

function strictModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['GIJUN_HITL_STRICT_MODE'] === '1'
}

/**
 * Task-level HITL evaluation at task creation time.
 *
 * Four axes recorded in the trigger payload:
 *   critical_complexity, complex_complexity, incomplete_context,
 *   strict_mode_downgraded.
 *
 * Fail-closed principle: missing context fields escalate severity rather than
 * weaken the gate. critical complexity always requires HITL regardless of fields.
 * complex complexity requires HITL when strict mode is enabled OR all context
 * fields are present; otherwise v0.1.1 default emits a warning and lets it pass
 * (GIJUN_HITL_STRICT_MODE env var gates the transition — v0.1.2 will flip the
 * default to strict).
 */
export function evaluateTaskHitl(
  input: TaskHitlInput,
  opts: { now?: Date; env?: NodeJS.ProcessEnv } = {},
): TaskHitlDecision {
  const now = opts.now ?? new Date()
  const strict = strictModeEnabled(opts.env)
  const hasContext =
    input.toolName !== undefined &&
    input.actionType !== undefined &&
    input.resource !== undefined
  const axes: TaskHitlAxis[] = []

  if (input.complexity === 'critical') {
    axes.push('critical_complexity')
  } else if (input.complexity === 'complex') {
    axes.push('complex_complexity')
    if (!hasContext) axes.push('incomplete_context')
  } else if (!hasContext) {
    // trivial / standard without context: no escalation (no axis to record).
  }

  let hitlRequired: boolean
  if (input.complexity === 'critical') {
    hitlRequired = true
  } else if (input.complexity === 'complex') {
    if (hasContext) {
      hitlRequired = true
    } else if (strict) {
      hitlRequired = true
    } else {
      hitlRequired = false
      axes.push('strict_mode_downgraded')
      console.warn(
        '[agentguard] complex task created without toolName/actionType/resource; HITL downgraded to 0 (set GIJUN_HITL_STRICT_MODE=1 to enforce)',
      )
    }
  } else {
    hitlRequired = false
  }

  const trigger: TaskHitlTriggerPayload = {
    ruleVersion: HITL_RULE_VERSION,
    evaluator: 'hitl-gate-v1',
    evaluatedAt: now.toISOString(),
    axes,
    inputs: {
      complexity: input.complexity,
      toolName: input.toolName ?? null,
      actionType: input.actionType ?? null,
      resource: input.resource ?? null,
    },
    mode: hasContext ? 'full' : 'complexity-only',
    strictMode: strict,
  }

  return { hitlRequired, trigger }
}

/**
 * @deprecated since v0.1.3 — use {@link evaluateTaskHitl}. Kept for
 * backwards compatibility; will be removed in v0.2 or v1.0. The two
 * functions share the same body; the rename disambiguates step-level vs
 * task-level evaluation, which the README/CHANGELOG conflated under "HITL".
 */
export function evaluateHitlForTask(
  input: TaskHitlInput,
  opts: { now?: Date; env?: NodeJS.ProcessEnv } = {},
): TaskHitlDecision {
  return evaluateTaskHitl(input, opts)
}
