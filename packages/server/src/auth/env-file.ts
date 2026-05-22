import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname, resolve as pathResolve } from 'node:path'

const TOKEN_KEY = 'AGENTGUARD_TOKEN'

export class EnvFileError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'EnvFileError'
  }
}

export function resolveEnvFilePath(): string {
  const override = process.env['AGENTGUARD_ENV_FILE']
  if (override) {
    if (process.env['NODE_ENV'] !== 'test') {
      throw new EnvFileError(
        'env_file_override_in_non_test',
        'AGENTGUARD_ENV_FILE is only honored when NODE_ENV=test',
      )
    }
    return pathResolve(override)
  }
  return pathResolve(process.cwd(), '.env.local')
}

export function backupEnvFile(envPath?: string): { path: string; content: Buffer | null } {
  const path = envPath ?? resolveEnvFilePath()
  if (!existsSync(path)) return { path, content: null }
  return { path, content: readFileSync(path) }
}

export function restoreEnvFile(backup: { path: string; content: Buffer | null }): void {
  if (backup.content === null) {
    if (existsSync(backup.path)) unlinkSync(backup.path)
    return
  }
  const fd = openSync(backup.path, 'w', 0o600)
  try {
    writeSync(fd, backup.content)
  } finally {
    closeSync(fd)
  }
  chmodSync(backup.path, 0o600)
}

function replaceTokenLine(content: string, newToken: string): string {
  const lines = content.split('\n')
  let replaced = false
  const out = lines.map(line => {
    const trimmed = line.trimStart()
    if (trimmed.startsWith(`${TOKEN_KEY}=`)) {
      replaced = true
      return `${TOKEN_KEY}=${newToken}`
    }
    return line
  })
  if (!replaced) {
    if (out.length > 0 && out[out.length - 1] === '') {
      out[out.length - 1] = `${TOKEN_KEY}=${newToken}`
      out.push('')
    } else {
      out.push(`${TOKEN_KEY}=${newToken}`)
    }
  }
  return out.join('\n')
}

export function persistTokenToEnvFile(newToken: string, envPath?: string): void {
  const path = envPath ?? resolveEnvFilePath()
  if (existsSync(path)) {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      throw new EnvFileError('env_file_is_symlink', `${path} is a symlink; refusing to write`)
    }
  }
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  const updated = replaceTokenLine(existing, newToken)
  const dir = dirname(path)
  const tmpPath = pathResolve(dir, `.env.local.tmp.${process.pid}.${Date.now()}`)
  const fd = openSync(tmpPath, 'w', 0o600)
  try {
    writeSync(fd, updated)
  } finally {
    closeSync(fd)
  }
  chmodSync(tmpPath, 0o600)
  renameSync(tmpPath, path)
}

export function sweepTmpFiles(envPath?: string): number {
  const path = envPath ?? resolveEnvFilePath()
  const dir = dirname(path)
  let count = 0
  try {
    const entries = readdirSync(dir)
    for (const name of entries) {
      if (name.startsWith('.env.local.tmp.')) {
        try {
          unlinkSync(pathResolve(dir, name))
          count++
        } catch {
          // best-effort sweep
        }
      }
    }
  } catch {
    return 0
  }
  return count
}
