import { isValidRoomCode, normalizeRoomCode, randomRoomCode } from './guessGame'
import { cloudProxyBaseUrl } from './proxyConfig'

/**
 * 外层 query 的缓存破坏值：微信等会强缓存 GitHub Pages 的 index.html，
 * 扫码若仍打开旧 HTML，会继续打进旧包里的 workers.dev。
 * 跟中继域名绑定，换域名后二维码自然换参。
 */
function shareCacheBust(): string {
  try {
    return new URL(cloudProxyBaseUrl()).hostname.replace(/\./g, '')
  } catch {
    return '1'
  }
}

/**
 * HashRouter 下的房间分享链接。
 * 房号同时写在外层 query 与 hash 里：微信等常会剥掉 # 后半段，靠 ?room= 仍能进房。
 */
export function roomShareUrl(code: string): string {
  const clean = normalizeRoomCode(code)
  const { origin, pathname, search } = window.location
  const outer = new URLSearchParams(search)
  outer.set('room', clean)
  outer.set('v', shareCacheBust())
  return `${origin}${pathname}?${outer.toString()}#/games?room=${clean}`
}

export function readRoomParam(raw: string | null): string | null {
  if (!raw) return null
  const code = normalizeRoomCode(raw)
  return isValidRoomCode(code) ? code : null
}

/**
 * 启动时把外层 ?room= 迁进 Hash 路由。
 * 分享链路被剥 hash 后只剩 ?room=，否则会停在首页进不了房。
 */
export function promoteOuterRoomParam(): string | null {
  if (typeof window === 'undefined') return null
  const outer = new URLSearchParams(window.location.search)
  const code = readRoomParam(outer.get('room'))
  if (!code) return null

  const rawHash = window.location.hash.replace(/^#/, '')
  const qIdx = rawHash.indexOf('?')
  const hashPath = (qIdx >= 0 ? rawHash.slice(0, qIdx) : rawHash) || '/'
  const hashQuery = qIdx >= 0 ? rawHash.slice(qIdx + 1) : ''
  const hashParams = new URLSearchParams(hashQuery)
  const hashRoom = readRoomParam(hashParams.get('room'))

  const stripOuterRoom = () => {
    outer.delete('room')
    outer.delete('v')
    const qs = outer.toString()
    return `${window.location.pathname}${qs ? `?${qs}` : ''}`
  }

  // 已在同一房号的路由上：清掉外层 room，避免以后误跳
  if (hashRoom === code) {
    const next = `${stripOuterRoom()}#${rawHash}`
    const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (next !== cur) window.history.replaceState(null, '', next)
    return code
  }

  // 已在子游戏页：只把 room 并进当前 hash，不打断对局路径
  if (hashPath.startsWith('/games/') && hashPath !== '/games') {
    hashParams.set('room', code)
    const nextHash = `#${hashPath}?${hashParams.toString()}`
    window.history.replaceState(null, '', `${stripOuterRoom()}${nextHash}`)
    return code
  }

  // 首页 / 无房号 / 大厅：拉进游戏大厅并带上房号
  window.history.replaceState(
    null,
    '',
    `${stripOuterRoom()}#/games?room=${code}`,
  )
  return code
}

export function newRoomCode(): string {
  return randomRoomCode()
}
