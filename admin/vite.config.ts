import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 5173 is the old web customer site; the admin panel runs beside it.
  server: { port: 5174, host: true },
  preview: { port: 5174 },
  // The map library alone is about 1 MB; it is split out and only loaded on
  // screens with a map, so the size warning is about that chunk, not sign-in.
  build: { chunkSizeWarningLimit: 1200 },
})
