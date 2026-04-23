/**
 * REST client for the agentguard server API.
 * - parseResponseSafely: handles JSON, HTML error pages, empty bodies, non-text responses.
 * - RestError: structured error carrying both parsed body and raw text fallback.
 */

export class RestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly raw: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'RestError'
  }
}

async function parseResponseSafely(res: Response): Promise<{ body: unknown; raw?: string }> {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      return { body: await res.json() }
    } catch {
      return { body: null, raw: await res.text().catch(() => '<unreadable>') }
    }
  }
  const raw = await res.text().catch(() => '<unreadable>')
  return { body: null, raw }
}

export class RestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.token) headers['X-AgentGuard-Token'] = this.token

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const { body: parsed, raw } = await parseResponseSafely(res)

    if (!res.ok) {
      const errBody = parsed as { error?: { message?: string } } | null
      const message = errBody?.error?.message
        ?? (typeof parsed === 'string' ? parsed : null)
        ?? raw?.slice(0, 200)
        ?? `HTTP ${res.status}`
      throw new RestError(res.status, parsed, raw, message)
    }

    return parsed
  }

  get(path: string): Promise<unknown> { return this.call('GET', path) }
  post(path: string, body?: unknown): Promise<unknown> { return this.call('POST', path, body) }
  patch(path: string, body?: unknown): Promise<unknown> { return this.call('PATCH', path, body) }
}
