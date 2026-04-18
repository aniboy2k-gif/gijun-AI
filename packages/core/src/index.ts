export { getDb, runMigrations, closeDb } from './db/client.js'

export { appendAuditEvent, tailAuditEvents } from './audit/service.js'
export { verifyChain } from './audit/verify-chain.js'

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

export { createPolicy, evaluate as evaluatePolicy } from './policy/engine.js'

export { recordTrace, generateTraceId, getCostSummary } from './tracer/service.js'
