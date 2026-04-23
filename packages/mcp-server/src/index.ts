/**
 * agentguard MCP server — entry point.
 * Supports STDIO (default) and Streamable HTTP transports.
 * Tools call packages/server REST API (single-entry-point contract #1).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { RestClient, RestError } from './client.js'
import { TOOLS, findTool } from './tools.js'
import { startStdio, startHttp } from './transports.js'

const TRANSPORT = (process.env['AGENTGUARD_MCP_TRANSPORT'] ?? 'stdio').toLowerCase()
const SERVER_URL = process.env['AGENTGUARD_SERVER_URL'] ?? 'http://127.0.0.1:3456'
const REST_TOKEN = process.env['AGENTGUARD_TOKEN'] ?? ''
const MCP_TOKEN = process.env['AGENTGUARD_MCP_TOKEN'] ?? ''
const HTTP_PORT = parseInt(process.env['AGENTGUARD_MCP_PORT'] ?? '3457', 10)
const HTTP_HOST = '127.0.0.1'  // local-only (contract #5)

// fail-closed: HTTP mode requires its own token
if (TRANSPORT === 'http' && !MCP_TOKEN) {
  console.error('[agentguard-mcp] FATAL: AGENTGUARD_MCP_TOKEN required for http transport.')
  process.exit(1)
}

const client = new RestClient(SERVER_URL, REST_TOKEN)

const server = new Server(
  { name: 'agentguard', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = findTool(req.params.name)
  if (!tool) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: { message: `Unknown tool: ${req.params.name}` } }) }],
    }
  }

  try {
    const result = await tool.handler(req.params.arguments ?? {}, client)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (err) {
    if (err instanceof RestError) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: {
              status: err.status,
              message: err.message,
              body: err.body ?? err.raw,
            },
          }),
        }],
      }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: { message: msg } }) }],
    }
  }
})

// Audit session lifecycle events via REST (H2 reflection)
function auditSessionEvent(type: 'mcp.session_start' | 'mcp.session_end', sessionId: string): void {
  // Fire and forget — don't block session handling on audit write
  client.post('/audit', {
    eventType: type,
    action: `MCP session ${type === 'mcp.session_start' ? 'started' : 'ended'}: ${sessionId}`,
    resourceType: 'mcp_session',
    resourceId: sessionId,
    actor: 'system',
  }).catch(e => console.error(`[agentguard-mcp] audit failed:`, e.message))
}

if (TRANSPORT === 'http') {
  await startHttp(server, HTTP_PORT, HTTP_HOST, MCP_TOKEN, auditSessionEvent)
} else {
  await startStdio(server)
}
