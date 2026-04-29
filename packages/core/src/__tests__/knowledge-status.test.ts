import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

process.env['GIJUN_DB_PATH'] = ':memory:'
process.env['GIJUN_MIGRATIONS_PATH'] = resolve(__dirname, '../../../../migrations')

import { runMigrations, closeDb, getDb } from '../db/client.js'
import { tailAuditEvents } from '../audit/service.js'
import {
  createDaCandidate,
  nominateKnowledgeCandidate,
  approveKnowledgeCandidate,
  revokeKnowledgeApproval,
  rejectKnowledgeCandidate,
  restoreFromRejected,
  listKnowledgeDrafts,
  listKnowledge,
  promoteCandidate,
  createKnowledgeItem,
} from '../knowledge/retriever.js'

function isCodedError(e: unknown, code?: string): boolean {
  return e instanceof Error && 'code' in e && (code === undefined || (e as { code: string }).code === code)
}

before(() => { runMigrations() })
after(() => {
  closeDb()
  delete process.env['GIJUN_DB_PATH']
  delete process.env['GIJUN_MIGRATIONS_PATH']
})

type KRow = { id: number; status: string | null; layer: string; is_active: number; supersedes_id: number | null }

function getItem(id: number): KRow {
  return getDb().prepare('SELECT id, status, layer, is_active, supersedes_id FROM knowledge_items WHERE id = ?').get(id) as KRow
}

// ---------------------------------------------------------------------------
// createDaCandidate
// ---------------------------------------------------------------------------

test('createDaCandidate: creates a draft knowledge item', () => {
  const id = createDaCandidate({
    title: 'Test DA Result',
    content: 'This is a test DA final.txt content',
    reasoning: 'Useful pattern for architecture decisions',
    targetLayer: 'incident',
    sourceSessionId: '/tmp/da-chain-test',
  })
  assert.ok(id > 0)
  const row = getItem(id)
  assert.equal(row.status, 'draft')
  assert.equal(row.layer, 'incident')
  assert.equal(row.is_active, 1, 'draft items are active')
})

test('createDaCandidate: emits audit event', () => {
  const id = createDaCandidate({
    title: 'Audit Test Item',
    content: 'Content',
    reasoning: 'Audit check',
    targetLayer: 'project',
  })
  const events = tailAuditEvents(5) as { event_type: string; resource_id: string }[]
  const event = events.find(e => e.event_type === 'knowledge.da_candidate_created' && e.resource_id === String(id))
  assert.ok(event, 'audit event must be emitted')
})

// ---------------------------------------------------------------------------
// nominateKnowledgeCandidate
// ---------------------------------------------------------------------------

test('nominateKnowledgeCandidate: draft → candidate', () => {
  const id = createDaCandidate({ title: 'Nominate Test', content: 'c', reasoning: 'r', targetLayer: 'incident' })
  nominateKnowledgeCandidate(id)
  assert.equal(getItem(id).status, 'candidate')
})

test('nominateKnowledgeCandidate: compare-and-swap rejects wrong status', () => {
  const id = createDaCandidate({ title: 'CAS Test', content: 'c', reasoning: 'r', targetLayer: 'incident' })
  nominateKnowledgeCandidate(id)
  // Already candidate — cannot nominate again
  assert.throws(() => nominateKnowledgeCandidate(id), (e: unknown) => isCodedError(e))
})

// ---------------------------------------------------------------------------
// approveKnowledgeCandidate
// ---------------------------------------------------------------------------

test('approveKnowledgeCandidate: candidate → approved', () => {
  const id = createDaCandidate({ title: 'Approve Test', content: 'c', reasoning: 'r', targetLayer: 'global' })
  nominateKnowledgeCandidate(id)
  approveKnowledgeCandidate(id, { reason: 'LGTM' })
  const row = getItem(id)
  assert.equal(row.status, 'approved')
  assert.equal(row.is_active, 1)
})

test('approveKnowledgeCandidate: approved items appear in listKnowledge', () => {
  const id = createDaCandidate({ title: 'List Test', content: 'c', reasoning: 'r', targetLayer: 'project', project: 'test-proj' })
  nominateKnowledgeCandidate(id)
  approveKnowledgeCandidate(id)
  const items = listKnowledge({ layer: 'project' }) as { id: number }[]
  assert.ok(items.some(i => i.id === id), 'approved item must appear in list')
})

test('approveKnowledgeCandidate: draft cannot be approved directly', () => {
  const id = createDaCandidate({ title: 'Direct Approve Test', content: 'c', reasoning: 'r', targetLayer: 'incident' })
  assert.throws(() => approveKnowledgeCandidate(id), (e: unknown) => isCodedError(e))
})

// ---------------------------------------------------------------------------
// revokeKnowledgeApproval — DA CRITICAL C1
// ---------------------------------------------------------------------------

test('revokeKnowledgeApproval: approved → rejected', () => {
  const id = createDaCandidate({ title: 'Revoke Test', content: 'c', reasoning: 'r', targetLayer: 'incident' })
  nominateKnowledgeCandidate(id)
  approveKnowledgeCandidate(id)
  revokeKnowledgeApproval(id, 'Found error in content')
  const row = getItem(id)
  assert.equal(row.status, 'rejected')
  assert.equal(row.is_active, 0, 'rejected items must be inactive (GENERATED COLUMN)')
})

test('revokeKnowledgeApproval: rejected item does not appear in listKnowledge', () => {
  const id = createDaCandidate({ title: 'Hidden Test', content: 'c', reasoning: 'r', targetLayer: 'global' })
  nominateKnowledgeCandidate(id)
  approveKnowledgeCandidate(id)
  revokeKnowledgeApproval(id, 'removing')
  const items = listKnowledge() as { id: number }[]
  assert.ok(!items.some(i => i.id === id), 'rejected item must not appear in search results')
})

test('revokeKnowledgeApproval: draft cannot be revoked', () => {
  const id = createDaCandidate({ title: 'Draft Revoke Test', content: 'c', reasoning: 'r', targetLayer: 'incident' })
  assert.throws(() => revokeKnowledgeApproval(id, 'reason'), (e: unknown) => isCodedError(e))
})

// ---------------------------------------------------------------------------
// rejectKnowledgeCandidate
// ---------------------------------------------------------------------------

test('rejectKnowledgeCandidate: draft → rejected', () => {
  const id = createDaCandidate({ title: 'Reject Draft Test', content: 'c', reasoning: 'r', targetLayer: 'incident' })
  rejectKnowledgeCandidate(id, 'Not relevant')
  const row = getItem(id)
  assert.equal(row.status, 'rejected')
  assert.equal(row.is_active, 0)
})

test('rejectKnowledgeCandidate: candidate → rejected', () => {
  const id = createDaCandidate({ title: 'Reject Candidate Test', content: 'c', reasoning: 'r', targetLayer: 'incident' })
  nominateKnowledgeCandidate(id)
  rejectKnowledgeCandidate(id, 'Changed my mind')
  assert.equal(getItem(id).status, 'rejected')
})

// ---------------------------------------------------------------------------
// restoreFromRejected — Option A (new row + supersedes_id)
// ---------------------------------------------------------------------------

test('restoreFromRejected: creates new draft from rejected item', () => {
  const originalId = createDaCandidate({ title: 'Restore Test', content: 'original content', reasoning: 'r', targetLayer: 'incident' })
  rejectKnowledgeCandidate(originalId, 'Needed changes')
  const newId = restoreFromRejected(originalId, { reason: 'Fixed and restored' })

  assert.ok(newId > originalId, 'new row must have a higher id')
  const newRow = getItem(newId)
  assert.equal(newRow.status, 'draft')
  assert.equal(newRow.supersedes_id, originalId, 'supersedes_id must reference the rejected original')
  assert.equal(getItem(originalId).status, 'rejected', 'original row remains rejected (immutable)')
})

test('restoreFromRejected: emits audit event', () => {
  const originalId = createDaCandidate({ title: 'Restore Audit Test', content: 'c', reasoning: 'r', targetLayer: 'project' })
  rejectKnowledgeCandidate(originalId, 'rejected')
  const newId = restoreFromRejected(originalId)
  const events = tailAuditEvents(5) as { event_type: string; resource_id: string }[]
  const event = events.find(e => e.event_type === 'knowledge.restored_from_rejected' && e.resource_id === String(newId))
  assert.ok(event, 'restore audit event must be emitted')
})

test('restoreFromRejected: fails when item is not rejected', () => {
  const id = createDaCandidate({ title: 'Not Rejected', content: 'c', reasoning: 'r', targetLayer: 'incident' })
  assert.throws(() => restoreFromRejected(id), (e: unknown) => isCodedError(e))
})

// ---------------------------------------------------------------------------
// listKnowledgeDrafts
// ---------------------------------------------------------------------------

test('listKnowledgeDrafts: returns draft and candidate items', () => {
  const draftId = createDaCandidate({ title: 'Draft Item', content: 'c', reasoning: 'r', targetLayer: 'incident' })
  const candidateId = createDaCandidate({ title: 'Candidate Item', content: 'c', reasoning: 'r', targetLayer: 'incident' })
  nominateKnowledgeCandidate(candidateId)

  const drafts = listKnowledgeDrafts() as { id: number; status: string }[]
  assert.ok(drafts.some(d => d.id === draftId), 'draft items must appear')
  assert.ok(drafts.some(d => d.id === candidateId), 'candidate items must appear')
})

// ---------------------------------------------------------------------------
// promoteCandidate() backward-compat (deprecated path)
// ---------------------------------------------------------------------------

test('promoteCandidate: legacy path sets status=approved + layer=incident', () => {
  // Create via old API (layer='candidate')
  const id = createKnowledgeItem({ layer: 'candidate', title: 'Legacy Item', content: 'content' })
  promoteCandidate(id)
  const row = getItem(id)
  assert.equal(row.layer, 'incident')
  assert.equal(row.status, 'approved')
})
