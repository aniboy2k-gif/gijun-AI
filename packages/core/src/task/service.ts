import { z } from 'zod'
import { getDb } from '../db/client.js'
import { appendAuditEvent } from '../audit/service.js'

export const TaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  complexity: z.enum(['trivial', 'standard', 'complex', 'critical']).default('standard'),
  project: z.string().optional(),
  tags: z.array(z.string()).default([]),
  aiContext: z.record(z.unknown()).default({}),
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
  const db = getDb()

  const result = db.prepare(`
    INSERT INTO tasks (title, description, complexity, project, tags, ai_context)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    validated.title,
    validated.description ?? null,
    validated.complexity,
    validated.project ?? null,
    JSON.stringify(validated.tags),
    JSON.stringify(validated.aiContext),
  )

  const id = result.lastInsertRowid as number
  appendAuditEvent({ eventType: 'task.create', action: `created task: ${validated.title}`, resourceType: 'task', resourceId: String(id) })
  return id
}

export function updateTaskStatus(
  id: number,
  status: 'pending' | 'in_progress' | 'hitl_wait' | 'done' | 'cancelled',
): void {
  getDb().prepare(`
    UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, id)
  appendAuditEvent({ eventType: 'task.status_change', action: `task ${id} → ${status}`, resourceType: 'task', resourceId: String(id), taskId: id })
}

export function approveHitl(id: number): void {
  getDb().prepare(`
    UPDATE tasks
    SET hitl_approved_at = datetime('now'), status = 'in_progress', updated_at = datetime('now')
    WHERE id = ?
  `).run(id)
  appendAuditEvent({ eventType: 'task.hitl_approved', actor: 'human', action: `HITL approved task ${id}`, resourceType: 'task', resourceId: String(id), taskId: id })
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
