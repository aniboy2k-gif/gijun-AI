import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      '/tasks': 'http://127.0.0.1:3456',
      '/audit': 'http://127.0.0.1:3456',
      '/traces': 'http://127.0.0.1:3456',
      '/knowledge': 'http://127.0.0.1:3456',
      '/health': 'http://127.0.0.1:3456',
    },
  },
  build: { outDir: 'dist' },
})
