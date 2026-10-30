export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'T'
  | 'J'
  | 'Q'
  | 'K'
  | 'A'

export type Card = { rank: Rank; suit: Suit }

const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
const RANK_VAL: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
}

export function freshDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit })
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

export function formatCard(card: Card): string {
  return `${card.rank === 'T' ? '10' : card.rank}${card.suit}`
}

export function cardColor(card: Card): 'red' | 'black' {
  return card.suit === '♥' || card.suit === '♦' ? 'red' : 'black'
}

type HandRank = {
  tier: number
  kickers: number[]
  name: string
}

function ranksDesc(cards: Card[]) {
  return cards.map((c) => RANK_VAL[c.rank]).sort((a, b) => b - a)
}

function isFlush(cards: Card[]) {
  return cards.every((c) => c.suit === cards[0].suit)
}

function isStraight(vals: number[]): number | null {
  const uniq = [...new Set(vals)].sort((a, b) => b - a)
  if (uniq.includes(14)) uniq.push(1) // A-5
  for (let i = 0; i <= uniq.length - 5; i++) {
    const slice = uniq.slice(i, i + 5)
    if (slice[0] - slice[4] === 4 && new Set(slice).size === 5) {
      return slice[0] === 14 && slice[4] === 1 ? 5 : slice[0]
    }
  }
  return null
}

function evaluate5(cards: Card[]): HandRank {
  const vals = ranksDesc(cards)
  const flush = isFlush(cards)
  const straightHigh = isStraight(vals)
  const counts = new Map<number, number>()
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])

  if (flush && straightHigh) {
    return {
      tier: straightHigh === 14 ? 9 : 8,
      kickers: [straightHigh],
      name: straightHigh === 14 ? '皇家同花顺' : '同花顺',
    }
  }
  if (groups[0][1] === 4) {
    return { tier: 7, kickers: [groups[0][0], groups[1][0]], name: '四条' }
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return { tier: 6, kickers: [groups[0][0], groups[1][0]], name: '葫芦' }
  }
  if (flush) return { tier: 5, kickers: vals, name: '同花' }
  if (straightHigh) return { tier: 4, kickers: [straightHigh], name: '顺子' }
  if (groups[0][1] === 3) {
    return {
      tier: 3,
      kickers: [groups[0][0], ...groups.slice(1).map((g) => g[0])],
      name: '三条',
    }
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const high = Math.max(groups[0][0], groups[1][0])
    const low = Math.min(groups[0][0], groups[1][0])
    return { tier: 2, kickers: [high, low, groups[2][0]], name: '两对' }
  }
  if (groups[0][1] === 2) {
    return {
      tier: 1,
      kickers: [groups[0][0], ...groups.slice(1).map((g) => g[0])],
      name: '一对',
    }
  }
  return { tier: 0, kickers: vals, name: '高牌' }
}

function combinations5(cards: Card[]): Card[][] {
  const out: Card[][] = []
  const n = cards.length
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            out.push([cards[a], cards[b], cards[c], cards[d], cards[e]])
          }
        }
      }
    }
  }
  return out
}

export function bestHand(hole: Card[], board: Card[]): HandRank {
  const all = [...hole, ...board]
  if (all.length < 5) return evaluate5(all.concat(all).slice(0, 5))
  let best: HandRank | null = null
  for (const five of combinations5(all)) {
    const hand = evaluate5(five)
    if (!best || compareHand(hand, best) > 0) best = hand
  }
  return best!
}

export function compareHand(a: HandRank, b: HandRank): number {
  if (a.tier !== b.tier) return a.tier - b.tier
  const n = Math.max(a.kickers.length, b.kickers.length)
  for (let i = 0; i < n; i++) {
    const d = (a.kickers[i] || 0) - (b.kickers[i] || 0)
    if (d) return d
  }
  return 0
}

export const START_STACK = 1000
export const SMALL_BLIND = 10
export const BIG_BLIND = 20
