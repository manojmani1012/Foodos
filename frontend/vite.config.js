import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // host: true binds to every network interface so a phone on the same Wi-Fi
    // can open http://<your-pc-ip>:5173 instead of just localhost.
    host: true,
    port: 5173,
  },
})
