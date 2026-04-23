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

export { evaluateHitl, describeHitlTrigger } from './hitl/gate.js'
export type { HitlTrigger, ActionContext } from './hitl/gate.js'

export { shouldVerify, getVerifyMode, recordVerification } from './verify/strategy.js'

export { reportIncident, listCandidatePatterns, approvePatternPromotion, listIncidents } from './incident/service.js'

export { createPolicy, evaluate as evaluatePolicy, setPolicyActive, CostLimitConditionsSchema } from './policy/engine.js'
export { listPolicies } from './policy/query.js'

export { recordTrace, generateTraceId, getCostSummary, checkBudget } from './tracer/service.js'
export type { BudgetStatus, BudgetPeriod, BudgetScope } from './tracer/service.js'
