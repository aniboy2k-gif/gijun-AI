import { z } from 'zod'
import { getDb } from '../db/client.js'
import { withTxAndAudit } from '../lib/tx.js'
import { CodedError, ErrorCode } from '../lib/error-codes.js'
import { evaluateHitlForTask } from '../hitl/gate.js'
import type { AuditEventInput } from '../audit/service.js'

export const TaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  complexity: z.enum(['trivial', 'standard', 'complex', 'critical']).default('standard'),
  project: z.string().optional(),
  tags: z.array(z.string()).default([]),
  aiContext: z.record(z.unknown()).default({}),
  // Optional HITL context — present values improve risk judgement; missing values
  // may escalate `complex` complexity to HITL under strict mode (see evaluateHitlForTask).
  toolName: z.string().optional(),
  actionType: z.enum(['read', 'write', 'execute', 'delete']).optional(),
  resource: z.string().optional(),
})

export const TaskStepSchema = z.object({
  taskId: z.number().int(),
  stepNo: z.number().int().min(1),
  prompt: z.string().optional(),
  response: z.string().optional(),
  model: z.string().optional(),
  inputTokens: z.number().int().default(0),
  outputTokens: z.number().int().default(0),
  costUsd: z.number().default(0),
  latencyMs: z.number().int().default(0),
  toolCalls: z.array(z.unknown()).default([]),
})

export type TaskInput = z.input<typeof TaskSchema>
export type TaskStepInput = z.input<typeof TaskStepSchema>

type TaskRow = {
  id: number
  title: string
  description: string | null
  status: string
  complexity: string
  project: string | null
  ai_context: string
  hitl_required: number
  hitl_approved_at: string | null
  hitl_trigger: string | null
  tags: string
  created_at: string
  updated_at: string
}

export function createTask(input: TaskInput): number {
  const validated = TaskSchema.parse(input)

  const decision = evaluateHitlForTask({
    complexity: validated.complexity,
    ...(validated.toolName !== undefined ? { toolName: validated.toolName } : {}),
    ...(validated.actionType !== undefined ? { actionType: validated.actionType } : {}),
    ...(validated.resource !== undefined ? { resource: validated.resource } : {}),
  })

  return withTxAndAudit<number>(db => {
    const result = db.prepare(`
      INSERT INTO tasks
        (title, description, complexity, project, tags, ai_context, hitl_required, hitl_trigger)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      validated.title,
      validated.description ?? null,
      validated.complexity,
      validated.project ?? null,
      JSON.stringify(validated.tags),
      JSON.stringify(validated.aiContext),
      decision.hitlRequired ? 1 : 0,
      JSON.stringify(decision.trigger),
    )
    const id = result.lastInsertRowid as number
    const audit: AuditEventInput = {
      eventType: 'task.create',
      action: `created task: ${validated.title}`,
      resourceType: 'task',
      resourceId: String(id),
      payload: { hitlRequired: decision.hitlRequired, axes: decision.trigger.axes },
    }
    return { result: id, audit }
  })
}

export function updateTaskStatus(
  id: number,
  status: 'pending' | 'in_progress' | 'hitl_wait' | 'done' | 'cancelled',
): void {
  const db = getDb()
  const current = db.prepare(
    'SELECT hitl_required, hitl_approved_at FROM tasks WHERE id = ?',
  ).get(id) as { hitl_required: number; hitl_approved_at: string | null } | undefined

  if (!current) {
    throw new CodedError(ErrorCode.NOT_FOUND, `Task ${id} not found`)
  }

  if (status === 'done' && current.hitl_required === 1 && current.hitl_approved_at === null) {
    throw new CodedError(
      ErrorCode.HITL_REQUIRED,
      `Task ${id} requires HITL approval before transitioning to 'done'`,
    )
  }

  withTxAndAudit<void>(txDb => {
    txDb.prepare(`
      UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, id)
    const audit: AuditEventInput = {
      eventType: 'task.status_change',
      action: `task ${id} → ${status}`,
      resourceType: 'task',
      resourceId: String(id),
      taskId: id,
    }
    return { result: undefined, audit }
  })
}

export function approveHitl(id: number): void {
  withTxAndAudit<void>(db => {
    db.prepare(`
      UPDATE tasks
      SET hitl_approved_at = datetime('now'), status = 'in_progress', updated_at = datetime('now')
      WHERE id = ?
    `).run(id)
    const audit: AuditEventInput = {
      eventType: 'task.hitl_approved',
      actor: 'human',
      action: `HITL approved task ${id}`,
      resourceType: 'task',
      resourceId: String(id),
      taskId: id,
    }
    return { result: undefined, audit }
  })
}

export function addTaskStep(input: TaskStepInput): number {
  const validated = TaskStepSchema.parse(input)
  const result = getDb().prepare(`
    INSERT INTO task_steps
      (task_id, step_no, prompt, response, model, input_tokens, output_tokens, cost_usd, latency_ms, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    validated.taskId,
    validated.stepNo,
    validated.prompt ?? null,
    validated.response ?? null,
    validated.model ?? null,
    validated.inputTokens,
    validated.outputTokens,
    validated.costUsd,
    validated.latencyMs,
    JSON.stringify(validated.toolCalls),
  )
  return result.lastInsertRowid as number
}

export function listTasks(opts: { project?: string; status?: string; limit?: number } = {}): TaskRow[] {
  const conditions: string[] = []
  const values: (string | number | null)[] = []

  if (opts.project) { conditions.push('project = ?'); values.push(opts.project) }
  if (opts.status) { conditions.push('status = ?'); values.push(opts.status) }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  values.push(opts.limit ?? 50)

  return getDb()
    .prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as TaskRow[]
}

export function getTask(id: number): TaskRow | undefined {
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
}

export const ExternalTaskSchema = z.object({
  externalSource: z.string().min(1).max(128),
  externalId: z.string().min(1).max(256),
  title: z.string().min(1).max(512),
  description: z.string().max(4096).optional(),
  status: z.enum(['pending', 'in_progress', 'done', 'cancelled']).optional(),
})

export type ExternalTaskInput = z.input<typeof ExternalTaskSchema>

/**
 * Upsert a task from an external system (e.g., bulletin-board CSR outbox).
 * Idempotent: same (externalSource, externalId) pair always maps to the same task row.
 * Returns { id, created: true } on first insert, { id, created: false } on subsequent calls.
 */
export function upsertExternalTask(input: ExternalTaskInput): { id: number; created: boolean } {
  const validated = ExternalTaskSchema.parse(input)
  const db = getDb()

  const existing = db.prepare(
    'SELECT id FROM tasks WHERE external_source = ? AND external_id = ?'
  ).get(validated.externalSource, validated.externalId) as { id: number } | undefined

  if (existing) {
    const newStatus = validated.status
    if (newStatus !== undefined) {
      withTxAndAudit<void>(txDb => {
        txDb.prepare(
          "UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(newStatus, existing.id)
        const audit: AuditEventInput = {
          eventType: 'task.external_sync',
          action: `external sync: ${validated.externalSource}/${validated.externalId} → status=${newStatus}`,
          resourceType: 'task',
          resourceId: String(existing.id),
          payload: { externalSource: validated.externalSource, externalId: validated.externalId, status: newStatus },
        }
        return { result: undefined, audit }
      })
    }
    return { id: existing.id, created: false }
  }

  const id = withTxAndAudit<number>(txDb => {
    const result = txDb.prepare(`
      INSERT INTO tasks
        (title, description, complexity, external_source, external_id, status)
      VALUES (?, ?, 'standard', ?, ?, 'pending')
    `).run(
      validated.title,
      validated.description ?? null,
      validated.externalSource,
      validated.externalId,
    )
    const newId = result.lastInsertRowid as number
    const audit: AuditEventInput = {
      eventType: 'task.external_sync',
      action: `external task created: ${validated.externalSource}/${validated.externalId}`,
      resourceType: 'task',
      resourceId: String(newId),
      payload: { externalSource: validated.externalSource, externalId: validated.externalId, created: true },
    }
    return { result: newId, audit }
  })

  return { id, created: true }
}
