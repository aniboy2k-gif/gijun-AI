import path from 'node:path'
import { existsSync } from 'node:fs'

function resolvePackageRoot(): string {
  const candidates = [
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../..'),
  ]
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'package.json'))) {
      return candidate
    }
  }
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
  return candidates[0]!
}

export const MIGRATIONS_DIR: string = resolveMigrationsDir()
