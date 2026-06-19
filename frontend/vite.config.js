import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: '../backend/static' },
  server: { port: parseInt(process.env.PORT || '5173'), strictPort: true },
})
