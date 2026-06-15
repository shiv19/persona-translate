import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3133,
    allowedHosts: ["translate.shiv19.com"],
    // Proxy /api to the Node backend so the client and API share an origin
    // during dev (no CORS, no env wiring needed in the client).
    proxy: {
      '/api': {
        target: 'http://localhost:3134',
        changeOrigin: true,
      },
    },
  },
})
