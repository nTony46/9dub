/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5199,
    // Browser storage is per origin: silently moving to another port would open an empty app.
    strictPort: true,
    // Private inputs/outputs are never served as raw files.
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local-data/**', '**/Fantasy Draft Data/**'] },
  },
  preview: { port: 5199 },
  // Local-first single-page app loaded once from localhost; one ~310 kB gzip bundle is fine.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
  },
})
