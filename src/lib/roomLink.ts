import { isValidRoomCode, normalizeRoomCode, randomRoomCode } from './guessGame'

/** HashRouter 下的房间分享链接，两边打开同一个即可 */
export function roomShareUrl(code: string): string {
  const clean = normalizeRoomCode(code)
  const { origin, pathname, search } = window.location
  // 保留部署子路径的 query（若有），房间号放在 hash 路由上
  return `${origin}${pathname}${search}#/games?room=${clean}`
}

export function readRoomParam(raw: string | null): string | null {
  if (!raw) return null
  const code = normalizeRoomCode(raw)
  return isValidRoomCode(code) ? code : null
}

export function newRoomCode(): string {
  return randomRoomCode()
}
