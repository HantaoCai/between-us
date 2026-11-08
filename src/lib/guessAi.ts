import { countHits, type DigitLen } from './guessGame'

export type GuessHint = { guess: string; hits: number }

/** 生成全部合法编号（4/5 位很小；6 位约 100 万，仅在收窄候选时扫一次） */
export function allCodes(digits: DigitLen): string[] {
  const max = 10 ** digits
  const out = new Array<string>(max)
  for (let n = 0; n < max; n++) out[n] = String(n).padStart(digits, '0')
  return out
}

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
 * 按最新反馈收窄候选。
 * - 尚无池：扫一遍全集（或从已有 hints 过滤）
 * - 已有池：O(剩余) 过滤
 */
export function narrowCandidates(
  digits: DigitLen,
  pool: string[] | null,
  hints: GuessHint[],
): string[] {
  if (hints.length === 0) return pool ?? []
  if (pool && pool.length > 0) {
    return pool.filter((c) => matchesHints(c, hints))
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
    pool = narrowCandidates(digits, pool, hints)
    const fresh = pool.filter((c) => !tried.has(c))
    if (fresh.length === 0) return null
    const guess = fresh[Math.floor(Math.random() * fresh.length)]!
    return { guess, pool }
  }

  // 开局：随机，避开已试（极少发生）
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
