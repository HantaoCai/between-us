import { bestHand, BIG_BLIND, type Card, type Rank } from './poker'
import type { NoteAbout } from './notes'
import type { BotDriver, BotReply } from './botRoomSession'

type PubSnap = {
  street: string
  board: Card[]
  pot: number
  stacks: Record<NoteAbout, number>
  toAct: NoteAbout
  betThisRound: Record<NoteAbout, number>
  raisedThisStreet?: Record<NoteAbout, boolean>
  folded: NoteAbout | null
  matchOver?: boolean
  readyNext?: Record<NoteAbout, boolean>
}

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

/** Chen 公式近似，归一到 0..1（AA≈1，垃圾牌≈0.05） */
function preflopStrength(hole: Card[]): number {
  const [a, b] = hole
  const va = RANK_VAL[a.rank]
  const vb = RANK_VAL[b.rank]
  const high = Math.max(va, vb)
  const low = Math.min(va, vb)
  const paired = va === vb
  const suited = a.suit === b.suit
  const gap = high - low

  let score =
    high >= 14 ? 10 : high >= 13 ? 8 : high >= 12 ? 7 : high >= 11 ? 6 : high / 2

  if (paired) {
    score *= 2
    if (score < 5) score = 5
  }
  if (suited) score += 2
  if (!paired) {
    if (gap === 1) score += 1
    else if (gap === 2) score += 0
    else if (gap === 3) score -= 1
    else if (gap === 4) score -= 2
    else if (gap >= 5) score -= 3
    if (gap <= 1 && high < 12) score += 1
  }

  return Math.max(0.05, Math.min(1, score / 20))
}

function countSuit(cards: Card[], suit: Card['suit']) {
  return cards.filter((c) => c.suit === suit).length
}

/** 简易听牌加成：同花听 / 两头顺听 */
function drawBonus(hole: Card[], board: Card[]): number {
  if (board.length < 3 || board.length >= 5) return 0
  const all = [...hole, ...board]
  let bonus = 0

  for (const suit of ['♠', '♥', '♦', '♣'] as const) {
    if (countSuit(all, suit) === 4) {
      // 自己至少贡献一张才算听牌
      if (countSuit(hole, suit) >= 1) bonus += 0.18
      break
    }
  }

  const vals = [...new Set(all.map((c) => RANK_VAL[c.rank]))].sort((a, b) => a - b)
  const withA = vals.includes(14) ? [...vals, 1].sort((a, b) => a - b) : vals
  for (let i = 0; i + 3 < withA.length; i++) {
    const slice = withA.slice(i, i + 4)
    if (slice[3] - slice[0] === 3 && new Set(slice).size === 4) {
      bonus += 0.14
      break
    }
  }

  return Math.min(0.28, bonus)
}

/**
 * 牌力 0..1：翻前用 Chen；翻后按成牌档位映射（一对也有中等牌力），再加听牌。
 * 旧算法直接 tier/9 → 高牌=0、一对≈0.11，面对加注几乎必弃。
 */
function handStrength(hole: Card[], board: Card[]): number {
  if (hole.length < 2) return 0.2
  if (board.length === 0) return preflopStrength(hole)

  try {
    const hand = bestHand(hole, board)
    const k0 = hand.kickers[0] ?? 7
    let base: number
    switch (hand.tier) {
      case 0: // 高牌
        base = 0.12 + (k0 / 14) * 0.18
        break
      case 1: // 一对：底对偏弱，顶对偏强
        base = 0.38 + (k0 / 14) * 0.22
        break
      case 2:
        base = 0.62 + (k0 / 14) * 0.08
        break
      case 3:
        base = 0.78
        break
      case 4:
        base = 0.84
        break
      case 5:
        base = 0.88
        break
      case 6:
        base = 0.93
        break
      default:
        base = 0.97
    }
    return Math.min(1, base + drawBonus(hole, board))
  } catch {
    return 0.35
  }
}

/** 德州 bot：有牌力就跟/加，弱牌看赔率，偶尔诈唬；不再无脑弃 */
export function createPokerBotDriver(opts: {
  botWho: NoteAbout
  playerWho: NoteAbout
}): BotDriver {
  const botWho = opts.botWho
  let destroyed = false
  let replyFn: BotReply | null = null
  let pub: PubSnap | null = null
  let hole: Card[] = []
  let actToken = 0
  let timers: number[] = []

  function reply(data: unknown) {
    if (destroyed || !replyFn) return
    replyFn(data)
  }

  function later(ms: number, fn: () => void) {
    const id = window.setTimeout(() => {
      timers = timers.filter((t) => t !== id)
      if (!destroyed) fn()
    }, ms)
    timers.push(id)
  }

  function clearTimers() {
    for (const id of timers) window.clearTimeout(id)
    timers = []
  }

  function decide(): { kind: 'fold' | 'check' | 'call' | 'raise'; amount?: number } {
    if (!pub) return { kind: 'check' }
    const opp: NoteAbout = botWho === 'her' ? 'me' : 'her'
    const toCall = Math.max(0, pub.betThisRound[opp] - pub.betThisRound[botWho])
    const stack = Math.max(0, pub.stacks[botWho])
    const pot = Math.max(0, pub.pot)
    const s = handStrength(hole, pub.board ?? [])
    const alreadyRaised = !!pub.raisedThisStreet?.[botWho]
    const jitter = (Math.random() - 0.5) * 0.06
    const score = Math.max(0, Math.min(1, s + jitter))

    // 无人下注：过牌或价值加注 / 偶尔诈唬
    if (toCall <= 0) {
      if (stack <= 0) return { kind: 'check' }
      const wantRaise =
        !alreadyRaised &&
        stack > BIG_BLIND &&
        (score >= 0.55 || (score >= 0.42 && Math.random() < 0.22) || Math.random() < 0.08)
      if (wantRaise) {
        const mult = score >= 0.75 ? 3 : score >= 0.55 ? 2 : 1
        return {
          kind: 'raise',
          amount: Math.min(stack, BIG_BLIND * mult),
        }
      }
      return { kind: 'check' }
    }

    // 面对下注：赔率 + 牌力
    const potOdds = toCall / (pot + toCall)
    const callAffordable = toCall <= stack

    if (score >= 0.72 && !alreadyRaised && stack > toCall + BIG_BLIND) {
      const add = BIG_BLIND * (score >= 0.85 ? 3 : 2)
      return {
        kind: 'raise',
        amount: Math.min(stack, toCall + add),
      }
    }

    // 强牌 / 赔率合适 / 中等牌力小注 → 跟
    if (
      callAffordable &&
      (score >= 0.45 ||
        score >= potOdds + 0.08 ||
        (score >= 0.32 && toCall <= BIG_BLIND * 2) ||
        (score >= 0.28 && toCall <= Math.max(BIG_BLIND, pot * 0.25)))
    ) {
      return { kind: 'call' }
    }

    // 便宜跟注：再给一次机会
    if (callAffordable && toCall <= BIG_BLIND && score >= 0.22) {
      return { kind: 'call' }
    }

    // 偶尔跟大注诈唬（约 6%）
    if (callAffordable && score >= 0.2 && Math.random() < 0.06) {
      return { kind: 'call' }
    }

    return { kind: 'fold' }
  }

  function maybeAct() {
    if (!pub || pub.street === 'showdown' || pub.folded || pub.matchOver) {
      if (pub?.street === 'showdown' && !pub.matchOver && !pub.readyNext?.[botWho]) {
        later(600 + Math.floor(Math.random() * 500), () => {
          if (destroyed) return
          reply({ type: 'ready-next', who: botWho })
        })
      }
      return
    }
    if (pub.toAct !== botWho) return
    const token = ++actToken
    later(450 + Math.floor(Math.random() * 700), () => {
      if (destroyed || token !== actToken || !pub) return
      if (pub.toAct !== botWho || pub.street === 'showdown') return
      const action = decide()
      reply({
        type: 'action',
        who: botWho,
        kind: action.kind,
        amount: action.amount,
      })
    })
  }

  function adoptState(
    next: PubSnap,
    holes?: Partial<Record<NoteAbout, Card[]>>,
  ) {
    pub = next
    const mine = holes?.[botWho]
    if (Array.isArray(mine) && mine.length >= 2) hole = mine
    actToken += 1
    maybeAct()
  }

  return {
    onFromPlayer(raw, replyToPlayer) {
      if (destroyed) return
      replyFn = replyToPlayer
      if (!raw || typeof raw !== 'object' || !('type' in raw)) return
      const msg = raw as {
        type: string
        who?: NoteAbout
        public?: PubSnap
        holes?: Partial<Record<NoteAbout, Card[]>>
      }

      if (msg.type === 'hello') {
        reply({ type: 'hello', who: botWho })
        reply({ type: 'need-sync' })
        return
      }
      if (msg.type === 'hub-pick' || msg.type === 'hub-return') return
      if (msg.type === 'need-sync' || msg.type === 'action' || msg.type === 'show-hole') {
        return
      }
      if (msg.type === 'ready-next') return

      if (msg.type === 'deal' || msg.type === 'state') {
        if (!msg.public || typeof msg.public !== 'object') return
        if (msg.public.toAct !== 'her' && msg.public.toAct !== 'me') return
        adoptState(msg.public, msg.holes)
      }
    },
    destroy() {
      destroyed = true
      actToken += 1
      clearTimers()
      replyFn = null
      pub = null
      hole = []
    },
  }
}
