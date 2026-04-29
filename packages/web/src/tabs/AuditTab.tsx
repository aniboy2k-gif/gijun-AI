import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react'
import { useDataFreshness } from '@/lib/useFreshness'

type AuditEvent = {
  id: number; event_type: string; actor: string; action: string; created_at: string
}

export function AuditTab() {
  const { data: events, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.audit(50) as Promise<AuditEvent[]>,
    staleTime: 30_000,
  })
  const { data: integrity } = useQuery({
    queryKey: ['audit-integrity'],
    queryFn: api.auditIntegrity,
    staleTime: 60_000,
  })
  const { isStale, label } = useDataFreshness(dataUpdatedAt, 30)

  if (isLoading) return <Skeleton />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {integrity && (
            <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
              integrity.valid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {integrity.valid
                ? <><ShieldCheck size={12} /> 체인 정상</>
                : <><ShieldAlert size={12} /> 손상 {integrity.broken.length}건</>}
            </span>
          )}
          <span className={`text-xs ${isStale ? 'text-orange-500' : 'text-muted-foreground'}`}>{label}</span>
        </div>
        <button onClick={() => void refetch()} disabled={isFetching}
          className="p-1.5 rounded hover:bg-accent disabled:opacity-40">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="space-y-1.5">
        {(events ?? []).map(e => (
          <div key={e.id} className="flex items-start gap-3 p-2.5 border border-border rounded-lg text-xs">
            <span className="shrink-0 px-1.5 py-0.5 bg-accent rounded font-mono text-[10px]">{e.event_type}</span>
            <span className="flex-1 text-muted-foreground truncate">{e.action}</span>
            <span className="shrink-0 text-muted-foreground/60">{new Date(e.created_at).toLocaleTimeString('ko')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Skeleton() {
  return <div className="space-y-1.5">{[1,2,3,4,5].map(i => (
    <div key={i} className="h-9 rounded-lg bg-accent animate-pulse" />
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
