import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { RefreshCw } from 'lucide-react'
import { useDataFreshness } from '@/lib/useFreshness'

type KItem = {
  id: number; layer: string; title: string; status: string | null; updated_at: string
}

const LAYER_COLORS: Record<string, string> = {
  global: 'bg-blue-100 text-blue-800',
  project: 'bg-purple-100 text-purple-800',
  incident: 'bg-red-100 text-red-800',
  candidate: 'bg-gray-100 text-gray-600',
}
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  candidate: 'bg-orange-100 text-orange-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

export function KnowledgeTab() {
  const drafts = useQuery({
    queryKey: ['knowledge-drafts'],
    queryFn: () => api.knowledgeDrafts() as Promise<KItem[]>,
    staleTime: 30_000,
  })
  const approved = useQuery({
    queryKey: ['knowledge'],
    queryFn: () => api.knowledge() as Promise<KItem[]>,
    staleTime: 30_000,
  })
  const { isStale, label } = useDataFreshness(drafts.dataUpdatedAt, 30)
  const isLoading = drafts.isLoading || approved.isLoading
  const isError = drafts.isError || approved.isError
  const isFetching = drafts.isFetching || approved.isFetching

  const refetchAll = () => { void drafts.refetch(); void approved.refetch() }

  if (isLoading) return <Skeleton />
  if (isError) return <ErrorState onRetry={refetchAll} />

  const draftList = drafts.data ?? []
  const approvedList = approved.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {draftList.length > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
              검토 대기 {draftList.length}건
            </span>
          )}
          <span className={`text-xs ${isStale ? 'text-orange-500' : 'text-muted-foreground'}`}>{label}</span>
        </div>
        <button type="button" onClick={refetchAll} disabled={isFetching}
          className="p-1.5 rounded hover:bg-accent disabled:opacity-40">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {draftList.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">검토 대기</h3>
          {draftList.map(item => <KRow key={item.id} item={item} />)}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          승인됨 ({approvedList.length})
        </h3>
        {approvedList.length === 0
          ? <p className="text-sm text-muted-foreground py-4 text-center">승인된 항목 없음</p>
          : approvedList.map(item => <KRow key={item.id} item={item} />)}
      </section>
    </div>
  )
}

function KRow({ item }: { item: KItem }) {
  return (
    <div className="flex items-center gap-2 p-2.5 border border-border rounded-lg">
      <span className={`px-1.5 py-0.5 text-[10px] rounded ${LAYER_COLORS[item.layer] ?? 'bg-gray-100'}`}>
        {item.layer}
      </span>
      <span className="flex-1 text-sm truncate">{item.title}</span>
      {item.status && (
        <span className={`px-1.5 py-0.5 text-[10px] rounded ${STATUS_COLORS[item.status] ?? 'bg-gray-100'}`}>
          {item.status}
        </span>
      )}
    </div>
  )
}

function Skeleton() {
  return <div className="space-y-2">{[1,2,3].map(i => (
    <div key={i} className="h-10 rounded-lg bg-accent animate-pulse" />
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
