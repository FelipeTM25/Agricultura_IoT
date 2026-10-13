import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En desarrollo (npm run dev) las llamadas a /api van a la API local en el puerto 8001.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8001',
    },
  },
})
