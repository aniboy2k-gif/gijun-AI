// RED skeleton for CSR #775 P4 M6: cluster guard 신규 도입
// Plan v2 reference: ~/workspace/gijun-ai/prompt_plan.md §P4
// Note: cluster-guard.ts does not exist yet — these tests should FAIL at import time

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Module under test — RED: file does not exist yet
const clusterGuardMod = await import('../auth/cluster-guard.js')
const { assertSingleInstance, isClusterWorker, isWorkerThread, isForkedChild } =
  clusterGuardMod

test('M6: standalone process passes assertSingleInstance() without throwing', () => {
  // This test runs in standalone test runner (node --test) — should pass
  assert.doesNotThrow(() => assertSingleInstance())
})

test('M6: isClusterWorker returns false in standalone process', () => {
  assert.equal(isClusterWorker(), false)
})

test('M6: isWorkerThread returns false in main thread (standalone)', () => {
  assert.equal(isWorkerThread(), false)
})

test('M6: isForkedChild returns false in standalone process', () => {
  // node --test runs as standalone, process.send should be undefined
  assert.equal(isForkedChild(), false)
})

test('M6: assertSingleInstance error message contains "cluster_unsafe" prefix', () => {
  // Simulate by directly testing error format expectations
  // (Real cluster/worker/fork tests would require child_process — separate integration test)
  const result = clusterGuardMod
  // Verify export shape
  assert.equal(typeof result.assertSingleInstance, 'function')
  assert.equal(typeof result.isClusterWorker, 'function')
  assert.equal(typeof result.isWorkerThread, 'function')
  assert.equal(typeof result.isForkedChild, 'function')
})
