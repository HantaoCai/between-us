export type DigitLen = 4 | 5 | 6

export const DIGIT_LENS: readonly DigitLen[] = [4, 5, 6]

export function isDigitLen(n: number): n is DigitLen {
  return n === 4 || n === 5 || n === 6
}

export type GuessResult = {
  guess: string
  hits: number
  at: number
}

export function isValidNumber(value: string, digits: DigitLen): boolean {
  return new RegExp(`^\\d{${digits}}$`).test(value)
}

/** 只算「同一位置数字也相同」的个数。位数不同则无法判定。 */
export function countHits(secret: string, guess: string): number | null {
  if (secret.length === 0 || secret.length !== guess.length) return null
  let hits = 0
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) hits += 1
  }
  return hits
}

export function formatHits(hits: number): string {
  return `对了 ${hits} 位`
}

export type MatchOutcome = 'win' | 'lose' | 'draw'

/**
 * 判定本局结果。
 * - 双方都猜中：比轮次
 * - 一方已猜中，且对方已猜轮数 ≥ 我方轮次（对方就算下一轮才中也追不上）：提前定胜负
 */
export function resolveGuessMatch(opts: {
  iSolved: boolean
  peerSolved: boolean
  myTurns: number
  peerTurns: number | null
  peerGuessCount: number
}): { outcome: MatchOutcome; myTurns: number; peerTurns: number } | null {
  const mine = opts.myTurns
  const peerCount = opts.peerSolved
    ? (opts.peerTurns ?? opts.peerGuessCount)
    : opts.peerGuessCount

  if (opts.iSolved && opts.peerSolved) {
    if (mine < peerCount) return { outcome: 'win', myTurns: mine, peerTurns: peerCount }
    if (mine > peerCount) return { outcome: 'lose', myTurns: mine, peerTurns: peerCount }
    return { outcome: 'draw', myTurns: mine, peerTurns: peerCount }
  }

  // 我已猜中，对方还没中，但其已猜轮数已经 ≥ 我的轮次 → 我提前赢
  if (opts.iSolved && !opts.peerSolved && mine > 0 && peerCount >= mine) {
    return { outcome: 'win', myTurns: mine, peerTurns: peerCount }
  }

  // 对方已猜中，我还没中，但我已猜轮数已经 ≥ 对方轮次 → 我提前输
  if (!opts.iSolved && opts.peerSolved) {
    const peerT = opts.peerTurns ?? opts.peerGuessCount
    if (peerT > 0 && mine >= peerT) {
      return { outcome: 'lose', myTurns: mine, peerTurns: peerT }
    }
  }

  return null
}

export function matchOutcomeStatus(
  outcome: MatchOutcome,
  myTurns: number,
  peerTurns: number,
): string {
  if (outcome === 'win') return `你赢了 · ${myTurns} 轮 vs ${peerTurns} 轮`
  if (outcome === 'lose') return `对方赢了 · ${myTurns} 轮 vs ${peerTurns} 轮`
  return `平局 · 都是 ${myTurns} 轮`
}

export function matchWinCheer(myTurns: number, peerTurns: number): string {
  if (peerTurns > myTurns) {
    return `恭喜！你只用 ${myTurns} 轮就猜中了，比对方更少，胜利提前到手！`
  }
  return `恭喜！这局你赢了！`
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
