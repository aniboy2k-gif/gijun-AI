import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Check, RefreshCw } from 'lucide-react'

type Task = {
  id: number; title: string; status: string; complexity: string
  hitl_required: number; hitl_approved_at: string | null; created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  hitl_wait: 'bg-orange-100 text-orange-800',
  done: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
}

export function TasksTab() {
  const qc = useQueryClient()
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

  if (isLoading) return <Skeleton />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  const tasks = data ?? []
  const hitlPending = tasks.filter(t => t.status === 'hitl_wait')

  const handleApprove = (task: Task) => {
    if (!confirm(`HITL 승인: #${task.id} "${task.title}"\n\n승인 후 작업이 진행됩니다. 계속하시겠습니까?`)) return
    approveMutation.mutate(task.id)
  }

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
        <button type="button" onClick={() => void refetch()} disabled={isFetching}
          className="p-1.5 rounded hover:bg-accent disabled:opacity-40">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {approveMutation.isError && (
        <p className="text-xs text-red-600 px-1">승인 실패: {(approveMutation.error as Error).message}</p>
      )}

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">작업 없음</p>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => {
            const isApproving = approveMutation.isPending && approveMutation.variables === task.id
            return (
              <div key={task.id}
                className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-accent/50">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    #{task.id} · {task.complexity} · {new Date(task.created_at).toLocaleDateString('ko')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  {task.status === 'hitl_wait' && (
                    <button type="button"
                      onClick={() => handleApprove(task)}
                      disabled={isApproving}
                      className="flex items-center gap-1 h-6 px-2 text-xs font-medium border border-orange-300 text-orange-700 hover:bg-orange-50 rounded disabled:opacity-40">
                      <Check size={12} className={isApproving ? 'animate-pulse' : ''} />
                      {isApproving ? '승인 중' : '승인'}
                    </button>
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
