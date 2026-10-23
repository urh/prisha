import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages serves the demo at https://urh.github.io/prisha/
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
})
