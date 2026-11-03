import { isValidRoomCode, normalizeRoomCode, randomRoomCode } from './guessGame'
import { cloudProxyBaseUrl } from './proxyConfig'

/**
 * 分享进站（小游戏链接 / 带房号）后：本标签页锁在小游戏。
 * 从拾光点导航进小游戏不会走这里，仍可回拾光。
 */
const PLAY_ONLY_KEY = 'between-us:play-only'

export function enablePlayOnly(): void {
  try {
    sessionStorage.setItem(PLAY_ONLY_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function isPlayOnly(): boolean {
  try {
    return sessionStorage.getItem(PLAY_ONLY_KEY) === '1'
  } catch {
    return false
  }
}

/** 非小游戏路径（拾光墙、回忆等）在 play-only 下一律禁入 */
export function isPlayOnlyBlockedPath(pathname: string): boolean {
  if (!pathname || pathname === '/') return true
  if (pathname === '/games' || pathname.startsWith('/games/')) return false
  return true
}

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

function parseHash(): { path: string; params: URLSearchParams; raw: string } {
  const raw = window.location.hash.replace(/^#/, '')
  const qIdx = raw.indexOf('?')
  const path = (qIdx >= 0 ? raw.slice(0, qIdx) : raw) || '/'
  const params = new URLSearchParams(qIdx >= 0 ? raw.slice(qIdx + 1) : '')
  return { path, params, raw }
}

function stripOuterKeys(...keys: string[]): string {
  const outer = new URLSearchParams(window.location.search)
  for (const key of keys) outer.delete(key)
  const qs = outer.toString()
  return `${window.location.pathname}${qs ? `?${qs}` : ''}`
}

/**
 * 分享小游戏大厅（无房号）：对方从列表进房。
 * 外层 ?play=1 防微信剥 hash 后落到拾光首页。
 */
export function gamesShareUrl(): string {
  const { origin, pathname, search } = window.location
  const outer = new URLSearchParams(search)
  outer.set('play', '1')
  outer.set('v', shareCacheBust())
  outer.delete('room')
  return `${origin}${pathname}?${outer.toString()}#/games`
}

/**
 * HashRouter 下的房间分享链接（可选；当前主流程是无房号 + 列表进房）。
 * 房号同时写在外层 query 与 hash 里：微信等常会剥掉 # 后半段，靠 ?room= 仍能进房。
 */
export function roomShareUrl(code: string): string {
  const clean = normalizeRoomCode(code)
  const { origin, pathname, search } = window.location
  const outer = new URLSearchParams(search)
  outer.set('room', clean)
  outer.set('play', '1')
  outer.set('v', shareCacheBust())
  return `${origin}${pathname}?${outer.toString()}#/games?room=${clean}`
}

export function readRoomParam(raw: string | null): string | null {
  if (!raw) return null
  const code = normalizeRoomCode(raw)
  return isValidRoomCode(code) ? code : null
}

/**
 * 启动时处理分享入口：
 * - ?play=1 / 冷启动就在 #/games → play-only（无房号也行）
 * - ?room= → 迁进大厅并 play-only
 * 从拾光站内点进小游戏不经过此函数的「冷启动」判定之外的 reload。
 */
export function promoteOuterRoomParam(): string | null {
  if (typeof window === 'undefined') return null

  const outer = new URLSearchParams(window.location.search)
  const playFlag = outer.get('play') === '1'
  const code = readRoomParam(outer.get('room'))
  const { path: hashPath, params: hashParams, raw: rawHash } = parseHash()
  const hashRoom = readRoomParam(hashParams.get('room'))
  const onGames =
    hashPath === '/games' || hashPath.startsWith('/games/')

  // 冷启动就在小游戏（分享 #/games、无房号）或显式 play/room → 锁死
  if (playFlag || code || hashRoom || onGames) {
    enablePlayOnly()
  }

  // 仅 ?play=1（无房号）：拉进大厅，避免剥 hash 后停在拾光
  if (!code && playFlag && !onGames) {
    window.history.replaceState(
      null,
      '',
      `${stripOuterKeys('play', 'room', 'v')}#/games`,
    )
    return null
  }

  if (!code) {
    // 已在小游戏：清掉外层 play/v，避免地址栏一直挂着
    if (playFlag || outer.has('v')) {
      const next = `${stripOuterKeys('play', 'v')}#${rawHash || '/games'}`
      const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`
      if (next !== cur) window.history.replaceState(null, '', next)
    }
    return null
  }

  const base = () => stripOuterKeys('room', 'play', 'v')

  // 已在同一房号的路由上：清掉外层 room，避免以后误跳
  if (hashRoom === code) {
    const next = `${base()}#${rawHash}`
    const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (next !== cur) window.history.replaceState(null, '', next)
    return code
  }

  // 已在子游戏页：只把 room 并进当前 hash，不打断对局路径
  if (hashPath.startsWith('/games/') && hashPath !== '/games') {
    hashParams.set('room', code)
    const nextHash = `#${hashPath}?${hashParams.toString()}`
    window.history.replaceState(null, '', `${base()}${nextHash}`)
    return code
  }

  // 首页 / 无房号 / 大厅：拉进游戏大厅并带上房号
  window.history.replaceState(null, '', `${base()}#/games?room=${code}`)
  return code
}

export function newRoomCode(): string {
  return randomRoomCode()
}
