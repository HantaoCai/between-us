import type { PeerJSOption } from 'peerjs'

/**
 * 国内运营商常见对称 NAT，仅靠 Google STUN 很容易连不上。
 * 混用国内 STUN + 公共 TURN，提高直连/中继成功率。
 */
export const PEER_OPTIONS: PeerJSOption = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.qq.com' },
      { urls: 'stun:stun.miwifi.com' },
      { urls: 'stun:stun.l.google.com:19302' },
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
    iceCandidatePoolSize: 4,
  },
}
