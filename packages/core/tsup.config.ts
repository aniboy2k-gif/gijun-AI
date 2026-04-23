import { defineConfig } from 'tsup'
import { readFileSync, writeFileSync } from 'node:fs'

// esbuild strips the `node:` prefix from built-in specifiers (e.g. "node:sqlite" → "sqlite").
// node:sqlite has no npm equivalent, so we must restore the prefix after bundling.
async function patchNodeSqlite() {
  for (const file of ['dist/index.js', 'dist/index.mjs']) {
    try {
      const content = readFileSync(file, 'utf-8')
      const patched = content
        .replace(/require\("sqlite"\)/g, 'require("node:sqlite")')
        .replace(/from "sqlite"/g, 'from "node:sqlite"')
      if (patched !== content) writeFileSync(file, patched)
    } catch { /* file may not exist for one format */ }
  }
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  platform: 'node',
  async onSuccess() {
    await patchNodeSqlite()
  },
})
