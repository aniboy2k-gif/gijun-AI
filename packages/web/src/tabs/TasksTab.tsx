import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Check, Plus, RefreshCw, X } from 'lucide-react'
import { CreateTaskModal } from '@/components/CreateTaskModal'

type Task = {
  id: number; title: string; status: string; complexity: string
  hitl_required: number; hitl_approved_at: string | null; hitl_trigger: string | null
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  hitl_wait: 'bg-orange-100 text-orange-800',
  done: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
}

const TRIGGER_LABELS: Record<string, string> = {
  irreversible: '비가역 액션',
  blast_radius: '외부 영향',
  critical_complexity: '임계 복잡도',
  complex_complexity: '복잡도(컨텍스트 동반)',
  incomplete_context: '컨텍스트 부족',
  strict_mode_downgraded: '엄격 모드 우회',
  verify_fail: '검증 실패',
  low_confidence: '낮은 신뢰도',
  complexity: '복잡도',
}

function formatTrigger(trigger: string | null): string | null {
  if (!trigger) return null
  try {
    // hitl_trigger is produced by evaluateTaskHitl() in
    // packages/core/src/hitl/gate.ts. axes is a string[] of axis codes
    // (e.g. 'critical_complexity'), not an object array.
    const parsed = JSON.parse(trigger) as { axes?: string[]; reason?: string }
    if (parsed.axes?.length) {
      const labels = parsed.axes.map(a => TRIGGER_LABELS[a] ?? a).filter(Boolean)
      return labels.length ? labels.join(', ') : null
    }
    // Step-level fallback: evaluateStepHitl returns { reason: ... }.
    if (parsed.reason) return TRIGGER_LABELS[parsed.reason] ?? parsed.reason
    return null
  } catch {
    return null
  }
}

export function TasksTab() {
  const qc = useQueryClient()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.tasks({ limit: 50 }) as Promise<Task[]>,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.approveHitl(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: number) => api.updateTaskStatus(id, 'cancelled'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  if (isLoading) return <Skeleton />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  const tasks = data ?? []
  // A task "needs HITL" when hitl_required=1, not yet approved, and not in a
  // terminal state. createTask sets status='pending' even for critical tasks,
  // so matching only on status==='hitl_wait' would never show the button.
  const needsHitl = (t: Task): boolean =>
    t.hitl_required === 1
    && t.hitl_approved_at === null
    && t.status !== 'done'
    && t.status !== 'cancelled'
  const hitlPending = tasks.filter(needsHitl)

  const handleApprove = (task: Task) => {
    if (!confirm(`HITL 승인: #${task.id} "${task.title}"\n\n승인 후 작업이 진행됩니다. 계속하시겠습니까?`)) return
    approveMutation.mutate(task.id)
  }

  const handleReject = (task: Task) => {
    if (!confirm(`HITL 거부: #${task.id} "${task.title}"\n\n작업을 취소(cancelled)로 전환합니다. 계속하시겠습니까?`)) return
    rejectMutation.mutate(task.id)
  }

  const mutationError = (approveMutation.isError && (approveMutation.error as Error).message)
    || (rejectMutation.isError && (rejectMutation.error as Error).message)
    || null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{tasks.length}개 작업</span>
          {hitlPending.length > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 rounded-full">
              HITL 대기 {hitlPending.length}건
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-1 h-7 px-2.5 text-xs font-medium border border-border rounded hover:bg-accent">
            <Plus size={12} />
            새 작업
          </button>
          <button type="button" onClick={() => void refetch()} disabled={isFetching}
            className="p-1.5 rounded hover:bg-accent disabled:opacity-40">
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {createModalOpen && (
        <CreateTaskModal onClose={() => setCreateModalOpen(false)} />
      )}

      {mutationError && (
        <p className="text-xs text-red-600 px-1">처리 실패: {mutationError}</p>
      )}

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">작업 없음</p>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => {
            const isApproving = approveMutation.isPending && approveMutation.variables === task.id
            const isRejecting = rejectMutation.isPending && rejectMutation.variables === task.id
            const showHitl = needsHitl(task)
            const triggerText = showHitl ? formatTrigger(task.hitl_trigger) : null
            return (
              <div key={task.id}
                className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-accent/50">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    #{task.id} · {task.complexity} · {new Date(task.created_at).toLocaleDateString('ko')}
                    {triggerText && (
                      <span className="ml-2 text-orange-700">· HITL: {triggerText}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {showHitl && (
                    <>
                      <button type="button"
                        onClick={() => handleApprove(task)}
                        disabled={isApproving || isRejecting}
                        className="flex items-center gap-1 h-6 px-2 text-xs font-medium border border-orange-300 text-orange-700 hover:bg-orange-50 rounded disabled:opacity-40">
                        <Check size={12} className={isApproving ? 'animate-pulse' : ''} />
                        {isApproving ? '승인 중' : '승인'}
                      </button>
                      <button type="button"
                        onClick={() => handleReject(task)}
                        disabled={isApproving || isRejecting}
                        className="flex items-center gap-1 h-6 px-2 text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 rounded disabled:opacity-40">
                        <X size={12} className={isRejecting ? 'animate-pulse' : ''} />
                        {isRejecting ? '거부 중' : '거부'}
                      </button>
                    </>
                  )}
                  <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[task.status] ?? 'bg-gray-100'}`}>
                    {task.status}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Skeleton() {
  return <div className="space-y-2">{[1,2,3].map(i => (
    <div key={i} className="h-14 rounded-lg bg-accent animate-pulse" />
  ))}</div>
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-8 text-center space-y-3">
      <p className="text-sm text-muted-foreground">데이터를 불러오지 못했습니다.</p>
      <button type="button" onClick={onRetry} className="px-4 py-1.5 text-sm border border-border rounded hover:bg-accent">재시도</button>
    </div>
  )
}
