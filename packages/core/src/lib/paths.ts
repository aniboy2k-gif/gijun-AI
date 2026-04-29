import path from 'node:path'
import { existsSync } from 'node:fs'

// CJS/ESM compat: __dirname is defined in tsup's CJS bundle and in tsx's
// CJS emulation. For pure ESM runtimes we fall back to cwd — callers should
// override via AGENTGUARD_MIGRATIONS_PATH in that case.
const HERE: string = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // biome-ignore lint/suspicious/noTsIgnore: __dirname may not exist in ESM context — runtime check required
    // @ts-ignore
    return typeof __dirname !== 'undefined' ? (__dirname as string) : process.cwd()
  } catch {
    return process.cwd()
  }
})()

function resolvePackageRoot(): string {
  const candidates = [
    path.resolve(HERE, '..'),
    path.resolve(HERE, '../..'),
    path.resolve(HERE, '../../..'),
  ]
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'package.json'))) {
      return candidate
    }
  }
  // biome-ignore lint/style/noNonNullAssertion: candidates array always has at least one element
  return candidates[0]!
}

export const PACKAGE_ROOT: string = resolvePackageRoot()

function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(PACKAGE_ROOT, '../../migrations'),
    path.resolve(PACKAGE_ROOT, '../migrations'),
    path.resolve(PACKAGE_ROOT, 'migrations'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  // biome-ignore lint/style/noNonNullAssertion: candidates array always has at least one element
  return candidates[0]!
}

export const MIGRATIONS_DIR: string = resolveMigrationsDir()
