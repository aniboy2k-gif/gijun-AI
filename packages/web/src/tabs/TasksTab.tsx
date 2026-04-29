import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { RefreshCw } from 'lucide-react'

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
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.tasks({ limit: 50 }) as Promise<Task[]>,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })

  if (isLoading) return <Skeleton />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  const tasks = data ?? []
  const hitlPending = tasks.filter(t => t.status === 'hitl_wait')

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
        <button onClick={() => void refetch()} disabled={isFetching}
          className="p-1.5 rounded hover:bg-accent disabled:opacity-40">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">작업 없음</p>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => (
            <div key={task.id}
              className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-accent/50">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{task.title}</p>
                <p className="text-xs text-muted-foreground">
                  #{task.id} · {task.complexity} · {new Date(task.created_at).toLocaleDateString('ko')}
                </p>
              </div>
              <span className={`ml-3 px-2 py-0.5 text-xs rounded-full shrink-0 ${STATUS_COLORS[task.status] ?? 'bg-gray-100'}`}>
                {task.status}
              </span>
            </div>
          ))}
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
      <button onClick={onRetry} className="px-4 py-1.5 text-sm border border-border rounded hover:bg-accent">재시도</button>
    </div>
  )
}
