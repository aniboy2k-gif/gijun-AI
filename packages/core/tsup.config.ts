import { defineConfig } from 'tsup'
import { readFileSync, writeFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'

async function patchNodeBuiltins(dir: string) {
  for await (const file of glob(`${dir}/*.{js,mjs}`)) {
    const content = readFileSync(file as string, 'utf-8')
    const patched = content
      .replace(/require\("sqlite"\)/g, 'require("node:sqlite")')
      .replace(/from "sqlite"/g, 'from "node:sqlite"')
    if (patched !== content) writeFileSync(file as string, patched)
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
    await patchNodeBuiltins('dist')
    console.log('✓ node: prefix patched')
  },
})
