/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { localDataPlugin } from './scripts/localDataPlugin.ts'

export default defineConfig({
  // localDataPlugin: serves the private .local-data/ snapshot in dev/preview only (never bundled).
  // NINEDUB_LOCAL_DATA=off hides it (used by the demo-data end-to-end tests).
  // It also keeps .local-data/session-latest.json in sync with the app's session; NINEDUB_SESSION_SAVE=off
  // disables that (tests and throwaway servers must never overwrite your saved session).
  // It also runs the read-only ESPN league sync (cookies in .local-data/espn/, never sent to the page);
  // NINEDUB_ESPN=off turns it off (tests never contact ESPN).
  plugins: [
    react(),
    tailwindcss(),
    localDataPlugin({
      enabled: process.env.NINEDUB_LOCAL_DATA !== 'off',
      sessionSave: process.env.NINEDUB_SESSION_SAVE !== 'off',
      espn: process.env.NINEDUB_ESPN !== 'off',
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5199,
    // Browser storage is per origin: silently moving to another port would open an empty app.
    strictPort: true,
    // Private inputs/outputs are never served as raw files; the snapshot goes through localDataPlugin only.
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
