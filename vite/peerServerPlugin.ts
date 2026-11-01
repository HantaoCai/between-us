import type { Plugin } from 'vite'

/** 与 src/lib/peerConfig.ts 保持一致 */
export const DEV_PEER_PATH = '/between-us'
export const DEV_PEER_PORT = 9000

/**
 * 本地开发起一个 PeerServer，再经 Vite 代理暴露到页面同端口。
 * 手机扫局域网码时不必另开 9000，也不依赖易断的 0.peerjs.com。
 */
export function peerServerPlugin(): Plugin {
  let started = false

  return {
    name: 'between-us-peer-server',
    apply: 'serve',
    configureServer(server) {
      if (started) return
      started = true

      void import('peer')
        .then(({ PeerServer }) => {
          const peer = PeerServer({
            port: DEV_PEER_PORT,
            path: DEV_PEER_PATH,
            host: '127.0.0.1',
            corsOptions: { origin: true },
          })
          peer.on('error', (err: unknown) => {
            console.error('[peer-server]', err)
          })
          console.log(
            `[peer-server] 信令 http://127.0.0.1:${DEV_PEER_PORT}${DEV_PEER_PATH}（经 Vite 代理）`,
          )
        })
        .catch((err) => {
          console.error('[peer-server] 启动失败', err)
        })

      server.config.server.proxy = {
        ...server.config.server.proxy,
        [DEV_PEER_PATH]: {
          target: `http://127.0.0.1:${DEV_PEER_PORT}`,
          changeOrigin: true,
          ws: true,
        },
      }
    },
  }
}
