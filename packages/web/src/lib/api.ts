const TOKEN_KEY = 'gijun_token'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-AgentGuard-Token': token,
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => apiFetch<{ status: string }>('/health'),
  tasks: (params?: { status?: string; limit?: number }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return apiFetch<unknown[]>(`/tasks${qs ? `?${qs}` : ''}`)
  },
  audit: (n = 50) => apiFetch<unknown[]>(`/audit?n=${n}`),
  auditIntegrity: () => apiFetch<{ valid: boolean; total: number; broken: number[] }>('/audit/integrity-check'),
  costSummary: (period: string) => apiFetch<unknown>(`/traces/summary?period=${period}`),
  knowledgeDrafts: () => apiFetch<unknown[]>('/knowledge/drafts'),
  knowledge: () => apiFetch<unknown[]>('/knowledge'),
}
