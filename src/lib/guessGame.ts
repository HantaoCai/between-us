export type DigitLen = 4 | 5

export type GuessResult = {
  guess: string
  hits: number
  at: number
}

export function isValidNumber(value: string, digits: DigitLen): boolean {
  return new RegExp(`^\\d{${digits}}$`).test(value)
}

/** 只算「同一位置数字也相同」的个数 */
export function countHits(secret: string, guess: string): number {
  const n = Math.min(secret.length, guess.length)
  let hits = 0
  for (let i = 0; i < n; i++) {
    if (secret[i] === guess[i]) hits += 1
  }
  return hits
}

export function formatHits(hits: number): string {
  return `对了 ${hits} 位`
}

/** 6 位纯数字房间号，方便手机输入 */
export function randomRoomCode(): string {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += String(Math.floor(Math.random() * 10))
  }
  return code
}

export function normalizeRoomCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6)
}

export function isValidRoomCode(code: string): boolean {
  return /^\d{6}$/.test(code)
}

export const ROOM_PREFIX = 'between-us-guess-'
