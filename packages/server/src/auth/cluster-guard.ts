// CSR #775 P4 M6: cluster guard 신규 도입
// Refs: CSR #771 R3 Claude Web M-R3-3 (코드 correctness bug catch — isMainThread import 누락)
// Plan v2: ~/workspace/gijun-ai/prompt_plan.md §P4
//
// Purpose: single-process invariant 강제. Token holder의 rotateInFlight boolean mutex는
// cluster mode 또는 worker_threads 환경에서 invariant가 깨짐. Boot 시점에 fail-closed.

import cluster from 'node:cluster'
import { isMainThread } from 'node:worker_threads'

export function isClusterWorker(): boolean {
  return cluster.isWorker
}

export function isWorkerThread(): boolean {
  return !isMainThread
}

export function isForkedChild(): boolean {
  // child_process.fork() spawned process has process.send as a function;
  // standalone or cluster-primary has undefined.
  return typeof process.send === 'function'
}

export class ClusterUnsafeError extends Error {
  constructor(public reason: string) {
    super(`cluster_unsafe: ${reason}`)
    this.name = 'ClusterUnsafeError'
  }
}

export function assertSingleInstance(): void {
  if (isClusterWorker()) {
    throw new ClusterUnsafeError('worker process detected (cluster.isWorker=true)')
  }
  if (isWorkerThread()) {
    throw new ClusterUnsafeError('worker thread detected (isMainThread=false)')
  }
  if (isForkedChild()) {
    throw new ClusterUnsafeError(
      'forked child process detected (process.send is function)',
    )
  }
}
