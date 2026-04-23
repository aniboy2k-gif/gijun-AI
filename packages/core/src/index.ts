export { getDb, runMigrations, closeDb, assertSchemaChain } from './db/client.js'

export { appendAuditEvent, insertAuditEventInTx, tailAuditEvents, redactPayload, AuditEventSchema } from './audit/service.js'
export type { AuditEventInput } from './audit/service.js'
export { verifyChain, runVerifyChainCli } from './audit/verify-chain.js'

export { createPlaybook, updatePlaybook, listPlaybooks, getPlaybook } from './playbook/service.js'

export {
  createTask, updateTaskStatus, approveHitl, addTaskStep, listTasks, getTask
} from './task/service.js'

export {
  searchKnowledge, createKnowledgeItem, promoteCandidate, listKnowledge
} from './knowledge/retriever.js'

export { evaluateHitl, describeHitlTrigger, evaluateHitlForTask } from './hitl/gate.js'
export type { HitlTrigger, ActionContext, TaskHitlInput, TaskHitlDecision, TaskHitlTriggerPayload } from './hitl/gate.js'

export { withTxAndAudit } from './lib/tx.js'
export { ErrorCode, CodedError } from './lib/error-codes.js'
export { LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT, POLICY_EVAL_SAFE_CAP, HITL_RULE_VERSION } from './lib/limits.js'
export { PACKAGE_ROOT, MIGRATIONS_DIR } from './lib/paths.js'
export { toPublicFieldErrors } from './lib/error-mask.js'
export { safeTokenCompare } from './lib/crypto-compare.js'

export { shouldVerify, getVerifyMode, recordVerification } from './verify/strategy.js'

export { reportIncident, listCandidatePatterns, approvePatternPromotion, listIncidents } from './incident/service.js'

export { createPolicy, evaluate as evaluatePolicy, setPolicyActive, CostLimitConditionsSchema } from './policy/engine.js'
export { listPolicies } from './policy/query.js'

export { recordTrace, generateTraceId, getCostSummary, checkBudget } from './tracer/service.js'
export type { BudgetStatus, BudgetPeriod, BudgetScope } from './tracer/service.js'
