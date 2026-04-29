import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { RefreshCw } from 'lucide-react'
import { useDataFreshness } from '@/lib/useFreshness'

type Period = '1h' | '24h' | '7d' | '30d' | 'mtd'
type Summary = {
  period: string; total_calls: number; total_cost_usd: number
  total_input_tokens: number; total_output_tokens: number; avg_latency_ms: number
}

const PERIODS: { value: Period; label: string }[] = [
  { value: '1h', label: '1시간' }, { value: '24h', label: '24시간' },
  { value: '7d', label: '7일' }, { value: '30d', label: '30일' }, { value: 'mtd', label: '이번 달' },
]

export function CostTab() {
  const [period, setPeriod] = useState<Period>('24h')
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['cost', period],
    queryFn: () => api.costSummary(period) as Promise<Summary>,
    staleTime: 30_000,
  })
  const { isStale, label } = useDataFreshness(dataUpdatedAt, 30)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button type="button" key={p.value} onClick={() => setPeriod(p.value)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                period === p.value ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void refetch()} disabled={isFetching}
          className="p-1.5 rounded hover:bg-accent disabled:opacity-40">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {isLoading ? <Skeleton /> : isError ? <ErrorState onRetry={() => void refetch()} /> : data ? (
        <>
          <p className={`text-xs ${isStale ? 'text-orange-500' : 'text-muted-foreground'}`}>{label}</p>
          <div className="grid grid-cols-2 gap-3">
            <Card label="총 비용" value={`$${(data.total_cost_usd ?? 0).toFixed(4)}`} />
            <Card label="API 호출" value={String(data.total_calls ?? 0)} />
            <Card label="입력 토큰" value={fmt(data.total_input_tokens ?? 0)} />
            <Card label="출력 토큰" value={fmt(data.total_output_tokens ?? 0)} />
            <Card label="평균 지연" value={`${Math.round(data.avg_latency_ms ?? 0)}ms`} />
          </div>
        </>
      ) : null}
    </div>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 border border-border rounded-xl space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
function fmt(n: number) { return n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n/1_000).toFixed(0)}K` : String(n) }
function Skeleton() {
  return <div className="grid grid-cols-2 gap-3">{[1,2,3,4,5].map(i => (
    <div key={i} className="h-20 rounded-xl bg-accent animate-pulse" />
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
