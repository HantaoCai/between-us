import { countHits, type DigitLen } from './guessGame'

export type GuessHint = { guess: string; hits: number }

export function randomCode(digits: DigitLen): string {
  const max = 10 ** digits
  return String(Math.floor(Math.random() * max)).padStart(digits, '0')
}

/** 与已有 (guess, hits) 全部一致 */
export function matchesHints(candidate: string, hints: GuessHint[]): boolean {
  for (const h of hints) {
    if (countHits(candidate, h.guess) !== h.hits) return false
  }
  return true
}

/**
 * 按反馈收窄候选。
 * - 尚无池：扫全集，用全部 hints 过滤（4/5 位瞬时；6 位约百万次，只发生一次）
 * - 已有池：只套最新一条 hint（O(剩余)）
 */
export function narrowCandidates(
  digits: DigitLen,
  pool: string[] | null,
  hints: GuessHint[],
): string[] {
  if (hints.length === 0) return pool ?? []
  const latest = hints[hints.length - 1]!
  if (pool && pool.length > 0) {
    return pool.filter((c) => countHits(c, latest.guess) === latest.hits)
  }
  const max = 10 ** digits
  const out: string[] = []
  for (let n = 0; n < max; n++) {
    const c = String(n).padStart(digits, '0')
    if (matchesHints(c, hints)) out.push(c)
  }
  return out
}

/**
 * 选下一猜：只从仍可能是答案的候选里抽，绝不重复已猜。
 * 无历史时随机开局；候选耗尽则 null。
 */
export function pickSmartGuess(opts: {
  digits: DigitLen
  hints: GuessHint[]
  tried: ReadonlySet<string>
  pool: string[] | null
}): { guess: string; pool: string[] } | null {
  const { digits, hints, tried } = opts
  let pool = opts.pool

  if (hints.length > 0) {
    // 池已按 hints 收窄过则不再重复过滤；否则建池
    if (!pool || pool.length === 0) {
      pool = narrowCandidates(digits, null, hints)
    }
    const fresh = pool.filter((c) => !tried.has(c))
    if (fresh.length === 0) return null
    const guess = fresh[Math.floor(Math.random() * fresh.length)]!
    return { guess, pool }
  }

  for (let i = 0; i < 64; i++) {
    const guess = randomCode(digits)
    if (!tried.has(guess)) return { guess, pool: pool ?? [] }
  }
  const max = 10 ** digits
  for (let n = 0; n < max; n++) {
    const guess = String(n).padStart(digits, '0')
    if (!tried.has(guess)) return { guess, pool: pool ?? [] }
  }
  return null
}
