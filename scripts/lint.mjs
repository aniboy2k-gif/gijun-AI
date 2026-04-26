#!/usr/bin/env node
// Wrapper around Biome to bypass a pnpm 10 + macOS issue where
// `pnpm lint` invoking the bin shim causes the native Biome binary
// to terminate with `[warn] Linter process terminated abnormally`.
// Direct `node` invocation of Biome's dispatcher works fine.
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const biome = resolve(here, '..', 'node_modules', '@biomejs', 'biome', 'bin', 'biome')
const args = process.argv.slice(2).length ? process.argv.slice(2) : ['check']

const proc = spawn(process.execPath, [biome, ...args], {
  stdio: 'inherit',
  cwd: resolve(here, '..'),
})

proc.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1)
  }
  process.exit(code ?? 1)
})
