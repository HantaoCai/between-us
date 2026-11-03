import type { PeerJSOption } from 'peerjs'

/** 与 vite/peerServerPlugin.ts 保持一致 */
const DEV_PEER_PATH = '/between-us'

/**
 * 国内运营商常见对称 NAT，仅靠 Google STUN 很容易连不上。
 * STUN 精简；TURN 保留 UDP80 + UDP443 + TCP443，避免只留一条时扫码进房卡死。
 */
const ICE_CONFIG: NonNullable<PeerJSOption['config']> = {
  iceServers: [
    { urls: 'stun:stun.qq.com' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  // 预收集会拖慢首连；按需收集即可
  iceCandidatePoolSize: 0,
}

/**
 * 每次新建 Peer 时取配置。
 * 开发态走本页同主机的 Vite 代理 PeerServer；线上仍用 PeerJS 云信令。
 */
export function getPeerOptions(): PeerJSOption {
  const base: PeerJSOption = {
    debug: 1,
    config: ICE_CONFIG,
  }

  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const secure = window.location.protocol === 'https:'
    const port = Number(window.location.port) || (secure ? 443 : 80)
    return {
      ...base,
      // '/' = 用当前页面 hostname，电脑/手机同局域网都能打到同一信令
      host: '/',
      port,
      path: DEV_PEER_PATH,
      secure,
    }
  }

  return base
}

/** @deprecated 用 getPeerOptions()，开发态要按当前页面主机拼信令 */
export const PEER_OPTIONS: PeerJSOption = {
  debug: 1,
  config: ICE_CONFIG,
}

/** 把 PeerJS 英文错误收成可读中文 */
export function friendlyPeerError(err: unknown, fallback = '连接失败'): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/Lost connection to server/i.test(msg)) {
    return '信令断了，点重新进房再试（开发时请用局域网地址打开两边）'
  }
  if (/unavailable-id|is taken|already in use/i.test(msg)) {
    return '房间号还被旧连接占着，点重新进房再试一次'
  }
  if (/Could not connect to peer/i.test(msg)) {
    return '连不上对方，确认对方还在房间里'
  }
  if (/连信令超时|连不上/i.test(msg)) return msg
  return msg || fallback
}
