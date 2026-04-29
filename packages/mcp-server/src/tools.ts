/**
 * MCP tool definitions — 22 tools mapped 1:1 to REST endpoints.
 * Naming policy: READ prefix (get_/list_/search_/tail_/verify_/check_) or WRITE prefix (create_/update_/add_/append_/promote_/approve_/report_/nominate_/revoke_/reject_).
 * preflight_check and check_budget are READ-only diagnostics — their results MAY be ignored, and execution tools re-validate server-side.
 */
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { RestClient } from './client.js'

export type ToolDef = {
  name: string
  description: string
  zodSchema: z.ZodTypeAny
  inputSchema: Record<string, unknown>
  handler: (args: unknown, client: RestClient) => Promise<unknown>
}

function def<T extends z.ZodTypeAny>(
  name: string,
  description: string,
  zodSchema: T,
  handler: (args: z.infer<T>, client: RestClient) => Promise<unknown>,
): ToolDef {
  return {
    name,
    description,
    zodSchema,
    inputSchema: zodToJsonSchema(zodSchema, { target: 'openApi3' }) as Record<string, unknown>,
    handler: (args, client) => handler(zodSchema.parse(args) as z.infer<T>, client),
  }
}

// ============================================================
// READ tools (9) — no side effects
// ============================================================

const ListTasksSchema = z.object({
  project: z.string().optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
})

const GetTaskSchema = z.object({ id: z.number().int() })

const TailAuditSchema = z.object({ n: z.number().int().min(1).max(200).default(20) })

const VerifyAuditSchema = z.object({})

const SearchKnowledgeSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5),
  project: z.string().optional(),
})

const GetPlaybookSchema = z.object({ idOrSlug: z.string().min(1) })

const GetCostSummarySchema = z.object({
  period: z.enum(['1h', '24h', '7d', '30d', 'mtd']).default('24h'),
})

const CheckBudgetSchema = z.object({
  toolName: z.string().optional(),
  resource: z.string().optional(),
})

const PreflightSchema = z.object({
  action: z.string().min(1),
  toolName: z.string().optional(),
  actionType: z.enum(['read', 'write', 'execute', 'delete']).optional(),
  complexity: z.enum(['trivial', 'standard', 'complex', 'critical']).optional(),
})

// ============================================================
// WRITE tools (8) — state-changing
// ============================================================

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  complexity: z.enum(['trivial', 'standard', 'complex', 'critical']).default('standard'),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

const UpdateTaskStatusSchema = z.object({
  id: z.number().int(),
  status: z.enum(['pending', 'in_progress', 'hitl_wait', 'done', 'cancelled']),
})

const AddTaskStepSchema = z.object({
  id: z.number().int(),
  stepNo: z.number().int().min(1),
  prompt: z.string().optional(),
  response: z.string().optional(),
  model: z.string().optional(),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  costUsd: z.number().optional(),
  latencyMs: z.number().int().optional(),
})

const ApproveHitlSchema = z.object({ id: z.number().int() })

const AppendAuditSchema = z.object({
  eventType: z.string().min(1),
  action: z.string().min(1),
  taskId: z.number().int().optional(),
  actor: z.enum(['ai', 'human', 'system']).optional(),
  actorModel: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
})

const CreateKnowledgeSchema = z.object({
  layer: z.enum(['global', 'project', 'incident', 'candidate']),
  title: z.string().min(1),
  content: z.string().min(1),
  project: z.string().optional(),
  domain: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

const PromoteKnowledgeSchema = z.object({ id: z.number().int() })

// Knowledge lifecycle schemas (migration 007+)
const GetKnowledgeDraftsSchema = z.object({
  layer: z.enum(['global', 'project', 'incident']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

const CreateDaCandidateSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  reasoning: z.string().min(1),
  targetLayer: z.enum(['global', 'project', 'incident']),
  project: z.string().optional(),
  domain: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sourceSessionId: z.string().optional(),
})

const NominateKnowledgeSchema = z.object({ id: z.number().int() })

const ApproveKnowledgeCandidateSchema = z.object({
  id: z.number().int(),
  reason: z.string().optional(),
})

const RevokeKnowledgeApprovalSchema = z.object({
  id: z.number().int(),
  reason: z.string().min(1),
})

const RejectKnowledgeCandidateSchema = z.object({
  id: z.number().int(),
  reason: z.string().min(1),
})

const ReportIncidentSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  aiService: z.string().optional(),
  taskId: z.number().int().optional(),
  rootCause: z.string().optional(),
  resolution: z.string().optional(),
  preventionRule: z.string().optional(),
})

// ============================================================
// Tool registry
// ============================================================

export const TOOLS: ToolDef[] = [
  // READ
  def('list_tasks', 'List governance tasks with optional filters (project, status). READ-only.', ListTasksSchema,
    (a, c) => {
      const qs = new URLSearchParams()
      if (a.project) qs.set('project', a.project)
      if (a.status) qs.set('status', a.status)
      if (a.limit) qs.set('limit', String(a.limit))
      const suffix = qs.toString() ? `?${qs}` : ''
      return c.get(`/tasks${suffix}`)
    }),
  def('get_task', 'Get a single task by id. READ-only.', GetTaskSchema,
    (a, c) => c.get(`/tasks/${a.id}`)),
  def('tail_audit', 'Return the last N audit events (default 20). READ-only.', TailAuditSchema,
    (a, c) => c.get(`/audit?n=${a.n}`)),
  def('verify_audit_integrity', 'Re-compute the audit hash chain and report any broken links. READ-only.', VerifyAuditSchema,
    (_a, c) => c.get('/audit/integrity-check')),
  def('search_knowledge', 'Full-text search over the knowledge store. READ-only.', SearchKnowledgeSchema,
    (a, c) => c.post('/knowledge/search', a)),
  def('get_playbook', 'Get a single playbook by numeric id or slug. v0.1 supports single lookup only; list/search coming in v0.2.', GetPlaybookSchema,
    (a, c) => {
      const asNum = Number(a.idOrSlug)
      return Number.isInteger(asNum)
        ? c.get(`/playbooks/${asNum}`)
        : c.get(`/playbooks/slug/${encodeURIComponent(a.idOrSlug)}`)
    }),
  def('get_cost_summary', 'Aggregate token cost and latency over a time window. Supported periods: 1h, 24h, 7d, 30d, mtd (month-to-date). READ-only.', GetCostSummarySchema,
    (a, c) => c.get(`/traces/summary?period=${a.period}`)),
  def('check_budget', 'Advisory budget status check against the most specific active cost_limit policy. Returns under_budget | warning | critical | over_budget | no_policy | no_cost_data | invalid. Does NOT enforce; caller decides. Abnormal statuses are auto-appended to the audit log. READ-only from the caller perspective.', CheckBudgetSchema,
    (a, c) => c.post('/budget/check', a)),
  def('preflight_check', 'DIAGNOSTIC read-only check of what a proposed action would trigger (policy + HITL). Its result is advisory — execution tools re-validate server-side in atomic transactions. Safe to call with no side effects.', PreflightSchema,
    (a, c) => c.post('/preflight', a)),

  // WRITE
  def('create_task', 'Create a new governance task. WRITES to DB.', CreateTaskSchema,
    (a, c) => c.post('/tasks', a)),
  def('update_task_status', 'Change the status of an existing task. WRITES to DB.', UpdateTaskStatusSchema,
    (a, c) => c.patch(`/tasks/${a.id}/status`, { status: a.status })),
  def('add_task_step', 'Append a step (prompt/response/cost/latency) to a task. WRITES to DB.', AddTaskStepSchema,
    (a, c) => {
      const { id, ...body } = a
      return c.post(`/tasks/${id}/steps`, body)
    }),
  def('approve_hitl', 'Record a human approval for a HITL-gated task. WRITES to DB.', ApproveHitlSchema,
    (a, c) => c.post(`/tasks/${a.id}/hitl-approve`)),
  def('append_audit', 'Append an immutable audit event to the hash chain. WRITES to DB.', AppendAuditSchema,
    (a, c) => c.post('/audit', a)),
  def('create_knowledge', 'Create a knowledge-store item in a specific layer. WRITES to DB.', CreateKnowledgeSchema,
    (a, c) => c.post('/knowledge', a)),
  def('promote_knowledge', 'Promote a candidate knowledge item to the incident layer. WRITES to DB. Atomic with audit log.', PromoteKnowledgeSchema,
    (a, c) => c.post(`/knowledge/${a.id}/promote`)),
  def('report_incident', 'Report an incident caused by AI agent behavior. WRITES to DB.', ReportIncidentSchema,
    (a, c) => c.post('/incidents', a)),

  // Knowledge lifecycle tools (migration 007+) — READ +1, WRITE +4
  def('get_knowledge_drafts',
    'List knowledge items in draft or candidate status pending HITL review. READ-only.',
    GetKnowledgeDraftsSchema,
    (a, c) => {
      const qs = new URLSearchParams()
      if (a.layer) qs.set('layer', a.layer)
      if (a.limit) qs.set('limit', String(a.limit))
      const suffix = qs.toString() ? `?${qs}` : ''
      return c.get(`/knowledge/drafts${suffix}`)
    }),
  def('create_da_candidate',
    'WRITES: Pre-fill a knowledge draft from a DA result. Requires explicit user review (nominate → approve) before the item becomes searchable.',
    CreateDaCandidateSchema,
    (a, c) => c.post('/knowledge/da-candidate', a)),
  def('nominate_knowledge_candidate',
    'WRITES: Nominate a draft knowledge item for HITL approval (draft → candidate).',
    NominateKnowledgeSchema,
    (a, c) => c.post(`/knowledge/${a.id}/nominate`)),
  def('approve_knowledge_candidate',
    'WRITES: Approve a nominated knowledge candidate (candidate → approved). Item becomes searchable.',
    ApproveKnowledgeCandidateSchema,
    (a, c) => c.post(`/knowledge/${a.id}/approve`, { reason: a.reason })),
  def('revoke_knowledge_approval',
    'WRITES: Revoke an approved knowledge item (approved → rejected). Requires reason. Item becomes inactive.',
    RevokeKnowledgeApprovalSchema,
    (a, c) => c.post(`/knowledge/${a.id}/revoke`, { reason: a.reason })),
  def('reject_knowledge_candidate',
    'WRITES: Reject a draft or candidate knowledge item (draft|candidate → rejected).',
    RejectKnowledgeCandidateSchema,
    (a, c) => c.post(`/knowledge/${a.id}/reject`, { reason: a.reason })),
]

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find(t => t.name === name)
}
