import type { NoteAbout } from './notes'

export const FLIP_COUNT = 36
export const FLIP_COLS = 6

export const SPECIAL_PEEK = '👁️'
export const SPECIAL_SHUFFLE = '🔀'
export const SPECIAL_BOMB = '💥'

/** 15 对普通 + 3 对特殊 = 18 对 / 36 张 */
export const NORMAL_ICONS = [
  '☕',
  '🌧️',
  '🌙',
  '🍃',
  '📷',
  '🍜',
  '🌸',
  '🎵',
  '🍓',
  '🧸',
  '⭐',
  '🍀',
  '🧀',
  '🎀',
  '🫧',
] as const

export const SPECIAL_ICONS = [SPECIAL_PEEK, SPECIAL_SHUFFLE, SPECIAL_BOMB] as const

export type FlipScores = Record<NoteAbout, number>

export function emptyFlipScores(): FlipScores {
  return { her: 0, me: 0 }
}

export function shuffleList<T>(list: T[], rand: () => number = Math.random): T[] {
  const next = [...list]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[next[i], next[j]] = [next[j]!, next[i]!]
  }
  return next
}

export function buildFlipIcons(): string[] {
  const pairs = [...NORMAL_ICONS, ...SPECIAL_ICONS]
  return shuffleList(pairs.flatMap((icon) => [icon, icon]))
}

export function isSpecialIcon(icon: string): boolean {
  return (
    icon === SPECIAL_PEEK || icon === SPECIAL_SHUFFLE || icon === SPECIAL_BOMB
  )
}

/** 剩余对数（含即将配上的这一对）≤ 此值时，配对得分翻倍 */
export const ENDGAME_PAIRS = 3

export function remainingPairs(matched: boolean[]): number {
  return matched.filter((flag) => !flag).length / 2
}

export function isEndgame(matched: boolean[]): boolean {
  return remainingPairs(matched) <= ENDGAME_PAIRS
}

/** streak 含本步：第 1 次 1 分，第 2 次连击再 +1；炸弹基础 2；残局（≤3 对）再 ×2 */
export function pointsForMatch(
  icon: string,
  streak: number,
  pairsLeft: number,
): number {
  const base = icon === SPECIAL_BOMB ? 2 : 1
  const combo = Math.max(0, streak - 1)
  const raw = base + combo
  return pairsLeft <= ENDGAME_PAIRS ? raw * 2 : raw
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function flipEffectSeed(seq: number, moves: number, matchedCount: number): number {
  return (seq * 10007 + moves * 131 + matchedCount * 17 + 42) >>> 0
}

export function pickPeekIndices(
  matched: boolean[],
  seed: number,
  count = 2,
): number[] {
  const openable = matched
    .map((flag, i) => (flag ? -1 : i))
    .filter((i) => i >= 0)
  if (openable.length === 0) return []
  const rand = mulberry32(seed)
  const pool = shuffleList(openable, rand)
  return pool.slice(0, Math.min(count, pool.length))
}

/** 只打乱未配对位置上的牌面，双方用同一 seed 结果一致 */
export function shuffleUnmatchedIcons(
  icons: string[],
  matched: boolean[],
  seed: number,
): string[] {
  const idxs = matched
    .map((flag, i) => (flag ? -1 : i))
    .filter((i) => i >= 0)
  if (idxs.length < 2) return icons.slice()
  const rand = mulberry32(seed)
  const faces = shuffleList(
    idxs.map((i) => icons[i]!),
    rand,
  )
  const next = icons.slice()
  idxs.forEach((i, n) => {
    next[i] = faces[n]!
  })
  return next
}

export function nextTurnAfterClose(
  current: NoteAbout,
  skip: NoteAbout | null,
): { turn: NoteAbout; skip: NoteAbout | null } {
  const other = current === 'her' ? 'me' : 'her'
  if (skip === other) {
    return { turn: current, skip: null }
  }
  return { turn: other, skip }
}

export function flipWinner(
  scores: FlipScores,
  done: boolean,
): NoteAbout | 'draw' | null {
  if (!done) return null
  if (scores.her === scores.me) return 'draw'
  return scores.her > scores.me ? 'her' : 'me'
}

export function specialLabel(icon: string): string {
  if (icon === SPECIAL_PEEK) return '偷窥'
  if (icon === SPECIAL_SHUFFLE) return '洗牌'
  if (icon === SPECIAL_BOMB) return '炸弹'
  return ''
}

export function specialDesc(icon: string): string {
  if (icon === SPECIAL_PEEK) return '配对后，短暂亮出两张还未翻开的牌'
  if (icon === SPECIAL_SHUFFLE) return '配对后，打乱场上所有未配牌的位置'
  if (icon === SPECIAL_BOMB) return '基础 2 分，并让对方下一轮跳过'
  return ''
}

export const FLIP_SPECIAL_HELP = [
  { icon: SPECIAL_PEEK, name: '偷窥', desc: specialDesc(SPECIAL_PEEK) },
  { icon: SPECIAL_SHUFFLE, name: '洗牌', desc: specialDesc(SPECIAL_SHUFFLE) },
  { icon: SPECIAL_BOMB, name: '炸弹', desc: specialDesc(SPECIAL_BOMB) },
] as const
