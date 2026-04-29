import { useState, useRef, useEffect } from 'react'
import { api, getToken, setToken } from '@/lib/api'

interface TokenGateProps {
  children: React.ReactNode
}

type GateStatus = 'checking' | 'valid' | 'invalid' | 'server-down'

export function TokenGate({ children }: TokenGateProps) {
  const [status, setStatus] = useState<GateStatus>(() =>
    getToken() ? 'checking' : 'invalid'
  )
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const isVerifying = useRef(false)

  useEffect(() => {
    if (status !== 'checking') return
    if (isVerifying.current) return
    isVerifying.current = true

    api.health()
      .then(() => setStatus('valid'))
      .catch((err: { status?: number }) => {
        isVerifying.current = false
        if (err.status === 401) {
          setStatus('invalid')
        } else {
          // 503, ECONNREFUSED, network error → server not running
          setStatus('server-down')
        }
      })
  }, [status])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    setToken(input.trim())
    setInput('')
    setError('')
    isVerifying.current = false
    setStatus('checking')
  }

  if (status === 'valid') return <>{children}</>

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8 border border-border rounded-xl bg-card">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">gijun-ai</h1>
          <p className="text-sm text-muted-foreground">
            {status === 'checking' ? '인증 확인 중…' :
             status === 'server-down' ? '서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.' :
             'AGENTGUARD_TOKEN을 입력하세요.'}
          </p>
        </div>
        {status !== 'server-down' && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="토큰 입력"
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button
              type="submit"
              className="w-full py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              연결
            </button>
          </form>
        )}
        {status === 'server-down' && (
          <button
            type="button"
            onClick={() => { isVerifying.current = false; setStatus('checking') }}
            className="w-full py-2 text-sm font-medium border border-border rounded-md hover:bg-accent"
          >
            재시도
          </button>
        )}
      </div>
    </div>
  )
}
