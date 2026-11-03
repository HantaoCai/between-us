import { isValidRoomCode, normalizeRoomCode, randomRoomCode } from './guessGame'

const STORAGE_KEY = 'between-us:couple-room'

/** 读本机记住的常用房号（无效则当没有） */
export function getCoupleRoomCode(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const code = normalizeRoomCode(raw)
    return isValidRoomCode(code) ? code : null
  } catch {
    return null
  }
}

/** 把常用房号写进本机（两边打开同一链接后都会记住） */
export function saveCoupleRoomCode(codeRaw: string): void {
  if (typeof window === 'undefined') return
  const code = normalizeRoomCode(codeRaw)
  if (!isValidRoomCode(code)) return
  try {
    window.localStorage.setItem(STORAGE_KEY, code)
  } catch {
    /* private mode / quota */
  }
}

/** 没有常用房号就生成一个并保存 */
export function ensureCoupleRoomCode(): string {
  const existing = getCoupleRoomCode()
  if (existing) return existing
  const code = randomRoomCode()
  saveCoupleRoomCode(code)
  return code
}

/** 换一间：生成新码并覆盖本机记忆 */
export function resetCoupleRoomCode(): string {
  const code = randomRoomCode()
  saveCoupleRoomCode(code)
  return code
}
