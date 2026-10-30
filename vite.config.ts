import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { editApiPlugin } from './vite/editApiPlugin.ts'

// https://vite.dev/config/
export default defineConfig({
  // 相对路径，方便 GitHub Pages 子路径托管
  base: './',
  plugins: [react(), tailwindcss(), editApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 43217,
  },
  preview: {
    host: '0.0.0.0',
    port: 43217,
  },
})
