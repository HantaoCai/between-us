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

function matchesKnownMask(
  candidate: string,
  known: ReadonlyArray<string | null> | undefined,
): boolean {
  if (!known || known.length === 0) return true
  for (let i = 0; i < candidate.length; i++) {
    const k = known[i]
    if (k != null && candidate[i] !== k) return false
  }
  return true
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
  knownMask?: ReadonlyArray<string | null>
}): { guess: string; pool: string[] } | null {
  const { digits, hints, tried, knownMask } = opts
  let pool = opts.pool

  if (hints.length > 0) {
    // 池已按 hints 收窄过则不再重复过滤；否则建池
    if (!pool || pool.length === 0) {
      pool = narrowCandidates(digits, null, hints)
    }
    const fresh = pool.filter(
      (c) => !tried.has(c) && matchesKnownMask(c, knownMask),
    )
    if (fresh.length === 0) return null
    const guess = fresh[Math.floor(Math.random() * fresh.length)]!
    return { guess, pool }
  }

  for (let i = 0; i < 64; i++) {
    const guess = randomCode(digits)
    if (!tried.has(guess) && matchesKnownMask(guess, knownMask)) {
      return { guess, pool: pool ?? [] }
    }
  }
  const max = 10 ** digits
  for (let n = 0; n < max; n++) {
    const guess = String(n).padStart(digits, '0')
    if (!tried.has(guess) && matchesKnownMask(guess, knownMask)) {
      return { guess, pool: pool ?? [] }
    }
  }
  return null
}

/** 人机/对战支招：按已确认 hits 收窄后抽一个建议 */
export function suggestNextGuess(opts: {
  digits: DigitLen
  history: GuessHint[]
  knownMask?: ReadonlyArray<string | null>
}): { guess: string; remaining: number } | null {
  const tried = new Set(opts.history.map((h) => h.guess))
  const picked = pickSmartGuess({
    digits: opts.digits,
    hints: opts.history,
    tried,
    pool: null,
    knownMask: opts.knownMask,
  })
  if (!picked) return null
  const remaining = picked.pool.length > 0
    ? picked.pool.filter(
        (c) => !tried.has(c) && matchesKnownMask(c, opts.knownMask),
      ).length
    : 1
  return { guess: picked.guess, remaining: Math.max(1, remaining) }
}
