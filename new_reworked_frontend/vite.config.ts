import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Same backend contract as ../frontend: FastAPI on :8000 behind /api and /ws.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:8000', rewrite: (p) => p.replace(/^\/api/, '') },
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
