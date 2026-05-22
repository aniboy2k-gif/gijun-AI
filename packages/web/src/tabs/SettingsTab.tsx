import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, setToken } from '@/lib/api'
import { Database, Key, RefreshCw } from 'lucide-react'

function formatBytes(n: number | null): string {
  if (n === null || n === undefined) return 'n/a'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatRotatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko')
  } catch {
    return iso
  }
}

export function SettingsTab() {
  return (
    <div className="space-y-6">
      <AuthenticationSection />
      <DatabaseSection />
    </div>
  )
}

function AuthenticationSection() {
  const qc = useQueryClient()
  const [revealed, setRevealed] = useState<{ token: string; rotated_at: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const tokenInfoQuery = useQuery({
    queryKey: ['token-info'],
    queryFn: api.tokenInfo,
    refetchOnWindowFocus: false,
  })

  const rotateMutation = useMutation({
    mutationFn: api.rotateToken,
    onSuccess: (result) => {
      // M5: Do NOT call setToken() yet — wait until user acknowledges they
      // copied the new token. setToken() before acknowledgment risks losing
      // the only copy if the dialog is dismissed accidentally.
      setRevealed(result)
      setCopied(false)
      setAcknowledged(false)
    },
  })

  const handleRotate = () => {
    if (!confirm(
      '토큰을 회전합니다.\n\n' +
      '기존 토큰은 약 5초 후 무효화되며, 새 토큰은 화면에 한 번만 표시됩니다.\n' +
      '복사 후 안전한 곳에 보관하셔야 합니다.\n\n' +
      '계속하시겠습니까?',
    )) return
    rotateMutation.mutate()
  }

  const handleCopy = async () => {
    if (!revealed) return
    try {
      await navigator.clipboard.writeText(revealed.token)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const handleAcknowledge = () => {
    if (!revealed) return
    setToken(revealed.token)
    setRevealed(null)
    setCopied(false)
    setAcknowledged(true)
    void qc.invalidateQueries({ queryKey: ['token-info'] })
  }

  return (
    <section className="border border-border rounded-lg p-4 space-y-3">
      <header className="flex items-center gap-2">
        <Key size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">Authentication</h2>
      </header>

      {tokenInfoQuery.isLoading && (
        <p className="text-xs text-muted-foreground">불러오는 중…</p>
      )}
      {tokenInfoQuery.isError && (
        <p className="text-xs text-red-600">토큰 정보를 불러오지 못했습니다.</p>
      )}
      {tokenInfoQuery.data && (
        <dl className="text-xs space-y-1.5">
          <div className="flex">
            <dt className="w-28 text-muted-foreground">현재 토큰</dt>
            <dd className="font-mono">{tokenInfoQuery.data.masked}</dd>
          </div>
          <div className="flex">
            <dt className="w-28 text-muted-foreground">회전 일시</dt>
            <dd>{formatRotatedAt(tokenInfoQuery.data.rotated_at)}</dd>
          </div>
        </dl>
      )}

      <div className="pt-1">
        <button type="button"
          onClick={handleRotate}
          disabled={rotateMutation.isPending || revealed !== null}
          className="flex items-center gap-1.5 h-7 px-3 text-xs font-medium border border-orange-300 text-orange-700 hover:bg-orange-50 rounded disabled:opacity-40">
          <RefreshCw size={12} className={rotateMutation.isPending ? 'animate-spin' : ''} />
          {rotateMutation.isPending ? '회전 중' : '토큰 회전'}
        </button>
      </div>

      {rotateMutation.isError && (
        <p className="text-xs text-red-600">
          회전 실패: {(rotateMutation.error as Error).message}
        </p>
      )}

      {acknowledged && (
        <p className="text-xs text-green-700">새 토큰이 적용되었습니다.</p>
      )}

      {revealed && (
        <div className="mt-3 p-3 border border-orange-300 bg-orange-50 rounded space-y-2">
          <p className="text-xs font-medium text-orange-900">
            새 토큰 — 화면에 한 번만 표시됩니다
          </p>
          <p className="font-mono text-xs break-all bg-white p-2 rounded border border-orange-200">
            {revealed.token}
          </p>
          <div className="flex items-center gap-2">
            <button type="button"
              onClick={handleCopy}
              className="h-6 px-2 text-xs border border-orange-300 hover:bg-orange-100 rounded">
              {copied ? '복사됨 ✓' : '클립보드 복사'}
            </button>
            <button type="button"
              onClick={handleAcknowledge}
              disabled={!copied}
              className="h-6 px-2 text-xs font-medium border border-green-400 text-green-800 hover:bg-green-50 rounded disabled:opacity-40">
              복사 완료 — 적용
            </button>
          </div>
          <p className="text-xs text-orange-900">
            기존 토큰은 약 5초 후 무효화됩니다. 적용 전까지 새 토큰이 활성화되지 않습니다.
          </p>
        </div>
      )}
    </section>
  )
}

function DatabaseSection() {
  const qc = useQueryClient()
  const dbStatsQuery = useQuery({
    queryKey: ['db-stats'],
    queryFn: api.dbStats,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  })

  return (
    <section className="border border-border rounded-lg p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Database</h2>
        </div>
        <button type="button"
          onClick={() => void qc.invalidateQueries({ queryKey: ['db-stats'] })}
          disabled={dbStatsQuery.isFetching}
          className="p-1 rounded hover:bg-accent disabled:opacity-40">
          <RefreshCw size={12} className={dbStatsQuery.isFetching ? 'animate-spin' : ''} />
        </button>
      </header>

      {dbStatsQuery.isLoading && (
        <p className="text-xs text-muted-foreground">불러오는 중…</p>
      )}
      {dbStatsQuery.isError && (
        <p className="text-xs text-red-600">DB 통계를 불러오지 못했습니다.</p>
      )}
      {dbStatsQuery.data && (
        <dl className="text-xs space-y-1.5">
          <div className="flex">
            <dt className="w-28 text-muted-foreground">DB 경로</dt>
            <dd className="font-mono text-[11px] break-all">{dbStatsQuery.data.db_path}</dd>
          </div>
          <div className="flex">
            <dt className="w-28 text-muted-foreground">DB 크기</dt>
            <dd>{formatBytes(dbStatsQuery.data.db_size_bytes)}</dd>
          </div>
          <div className="flex">
            <dt className="w-28 text-muted-foreground">tasks</dt>
            <dd>{dbStatsQuery.data.tasks.toLocaleString()}</dd>
          </div>
          <div className="flex">
            <dt className="w-28 text-muted-foreground">audit_events</dt>
            <dd>{dbStatsQuery.data.audit_events.toLocaleString()}</dd>
          </div>
          <div className="flex">
            <dt className="w-28 text-muted-foreground">knowledge_items</dt>
            <dd>{dbStatsQuery.data.knowledge_items.toLocaleString()}</dd>
          </div>
          {dbStatsQuery.data.counts_are_approximate && (
            <p className="text-[11px] text-muted-foreground pt-1">
              ※ 카운트는 MAX(id) 기반 근사치입니다 (O(1) 조회).
            </p>
          )}
        </dl>
      )}
    </section>
  )
}
