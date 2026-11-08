import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { editApiPlugin } from './vite/editApiPlugin.ts'
import { DEV_PEER_PATH, DEV_PEER_PORT, peerServerPlugin } from './vite/peerServerPlugin.ts'

// https://vite.dev/config/
export default defineConfig({
  // 相对路径，方便 GitHub Pages 子路径托管
  base: './',
  plugins: [react(), tailwindcss(), editApiPlugin(), peerServerPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (
            id.includes('/react-dom') ||
            id.includes('/react/') ||
            id.includes('/react-router') ||
            id.includes('/scheduler')
          ) {
            return 'react-vendor'
          }
          if (id.includes('/peerjs') || id.includes('/peer/')) {
            return 'peer'
          }
          if (id.includes('/marked') || id.includes('/date-fns')) {
            return 'content'
          }
        },
      },
    },
  },
  server: {
    // true：同时挂 IPv4/IPv6，避免浏览器访问 localhost 优先走 ::1 打不开
    host: true,
    port: 43217,
    proxy: {
      // 本机 PeerServer；手机只访问 Vite 端口即可
      [DEV_PEER_PATH]: {
        target: `http://127.0.0.1:${DEV_PEER_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
    watch: {
      // 编辑 API 会写 notes.json；若热更新整页，刚上传的预览会被冲掉
      ignored: ['**/src/data/notes.json', '**/memories/_photos.json'],
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 43217,
  },
})