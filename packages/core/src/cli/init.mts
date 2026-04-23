/**
 * agentguard init — project initializer (ESM, run with tsx)
 *
 * Creates:
 *   .agentguard/agentguard.db   SQLite database
 *   .env.agentguard              AGENTGUARD_TOKEN (auto-generated)
 *   .claude/settings.json        MCP server entry (creates or merges)
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DEFAULT_PORT = 3456

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const result: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/)
    if (m?.[1] && m?.[2]) result[m[1]] = m[2]
  }
  return result
}

async function main(): Promise<void> {
  const cwd = process.cwd()
  const force = process.argv.includes('--force')

  const guardDir = resolve(cwd, '.agentguard')
  const envPath = resolve(cwd, '.env.agentguard')
  const dbPath = join(guardDir, 'agentguard.db')

  // Path to migrations relative to this file's location in packages/core/src/cli/
  const migrationsPath = resolve(__dirname, '../../../../migrations')

  // mcpServerPath: env var takes priority (allows custom installations).
  // Path traversal guard: resolved path must stay within the package root.
  const packageRoot = resolve(__dirname, '../../../..')
  const rawMcpPath = process.env['AGENTGUARD_MCP_SERVER_PATH']
    ?? resolve(__dirname, '../../../mcp-server/src/index.ts')
  const resolvedMcpPath = resolve(rawMcpPath)
  if (!resolvedMcpPath.startsWith(packageRoot)) {
    console.error('[agentguard] AGENTGUARD_MCP_SERVER_PATH is outside the package root')
    process.exit(1)
  }
  const mcpServerPath = resolvedMcpPath

  const mcpSettingsPath = resolve(cwd, '.claude/settings.json')

  // 1. .agentguard/ 디렉토리 생성
  mkdirSync(guardDir, { recursive: true })
  console.log(`✓ .agentguard/ 준비`)

  // 2. 토큰 생성 또는 재사용
  const existingEnv = loadEnvFile(envPath)
  const token = (!force && existingEnv['AGENTGUARD_TOKEN']) || generateToken()
  const tokenStatus = (existingEnv['AGENTGUARD_TOKEN'] && !force) ? '유지' : '신규 생성'

  const envLines = [
    `AGENTGUARD_TOKEN=${token}`,
    `AGENTGUARD_DB_PATH=${dbPath}`,
    `AGENTGUARD_MIGRATIONS_PATH=${migrationsPath}`,
    `AGENTGUARD_PORT=${DEFAULT_PORT}`,
  ]
  writeFileSync(envPath, envLines.join('\n') + '\n')
  console.log(`✓ .env.agentguard 작성 (토큰 ${tokenStatus})`)

  // 3. DB 마이그레이션 (env 설정 후 import)
  process.env['AGENTGUARD_DB_PATH'] = dbPath
  process.env['AGENTGUARD_MIGRATIONS_PATH'] = migrationsPath

  const { runMigrations } = await import('../db/client.js')
  runMigrations()
  console.log(`✓ DB 마이그레이션 완료 (${dbPath})`)

  // 4. .claude/settings.json MCP 설정 추가
  mkdirSync(resolve(cwd, '.claude'), { recursive: true })
  let settings: Record<string, unknown> = {}
  if (existsSync(mcpSettingsPath)) {
    try { settings = JSON.parse(readFileSync(mcpSettingsPath, 'utf-8')) } catch { /* ignore */ }
  }
  const mcpServers = (settings['mcpServers'] ?? {}) as Record<string, unknown>
  mcpServers['agentguard'] = {
    command: 'node',
    args: ['--import=tsx/esm', mcpServerPath],
    env: {
      AGENTGUARD_SERVER_URL: `http://127.0.0.1:${DEFAULT_PORT}`,
      AGENTGUARD_TOKEN: token,
    },
  }
  settings['mcpServers'] = mcpServers
  writeFileSync(mcpSettingsPath, JSON.stringify(settings, null, 2) + '\n')
  console.log(`✓ .claude/settings.json MCP 설정 추가`)

  console.log(`
agentguard 초기화 완료!

서버 시작:
  source .env.agentguard && node packages/server/dist/server.js

Claude Code에서 사용 가능한 MCP 도구:
  create_task · append_audit · search_knowledge
`)
}

main().catch(err => {
  console.error('초기화 실패:', (err as Error).message)
  process.exit(1)
})
