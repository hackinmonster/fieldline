import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // maplibre-gl v6 loads its worker relative to its own module; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8000', rewrite: (p) => p.replace(/^\/api/, '') },
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
