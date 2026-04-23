/**
 * Transport factories — STDIO (default) and Streamable HTTP.
 * HTTP mode manages sessions in memory; restart invalidates all sessions.
 */
import { randomUUID } from 'node:crypto'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express, { type Request, type Response } from 'express'

const MAX_SESSIONS = 10
const IDLE_TIMEOUT_MS = 30 * 60 * 1000  // 30 min
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000  // 5 min

type Session = {
  transport: StreamableHTTPServerTransport
  lastActivity: number
}

export async function startStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[agentguard-mcp] STDIO transport ready')
}

export async function startHttp(
  server: Server,
  port: number,
  host: string,
  token: string,
  auditSessionEvent: (type: 'mcp.session_start' | 'mcp.session_end', sessionId: string) => void,
): Promise<void> {
  const app = express()
  app.use(express.json())

  const sessions = new Map<string, Session>()

  // Periodic cleanup of idle sessions
  const cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [sid, s] of sessions.entries()) {
      if (now - s.lastActivity > IDLE_TIMEOUT_MS) {
        sessions.delete(sid)
        auditSessionEvent('mcp.session_end', sid)
        console.error(`[agentguard-mcp] session expired: ${sid}`)
      }
    }
  }, CLEANUP_INTERVAL_MS)
  cleanupTimer.unref?.()

  app.post('/mcp', async (req: Request, res: Response) => {
    // Auth
    if (req.headers['x-agentguard-mcp-token'] !== token) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const existingSid = req.headers['mcp-session-id'] as string | undefined
    let session = existingSid ? sessions.get(existingSid) : undefined

    if (!session) {
      // Enforce max sessions (LRU-ish: drop oldest)
      if (sessions.size >= MAX_SESSIONS) {
        const oldest = [...sessions.entries()].sort((a, b) => a[1].lastActivity - b[1].lastActivity)[0]
        if (oldest) {
          sessions.delete(oldest[0])
          auditSessionEvent('mcp.session_end', oldest[0])
          console.error(`[agentguard-mcp] session evicted (max reached): ${oldest[0]}`)
        }
      }
      const sid = randomUUID()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sid,
      })
      await server.connect(transport)
      session = { transport, lastActivity: Date.now() }
      sessions.set(sid, session)
      auditSessionEvent('mcp.session_start', sid)
      console.error(`[agentguard-mcp] session created: ${sid}`)
    }

    session.lastActivity = Date.now()
    await session.transport.handleRequest(req, res, req.body)
  })

  app.listen(port, host, () => {
    console.error(`[agentguard-mcp] HTTP transport listening on http://${host}:${port}/mcp`)
  })
}
