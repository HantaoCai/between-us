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
  committed?: Record<NoteAbout, number>
  raisedThisStreet?: Record<NoteAbout, boolean>
  folded: NoteAbout | null
  matchOver?: boolean
  readyNext?: Record<NoteAbout, boolean>
}

export type PokerBotAction = {
  kind: 'fold' | 'check' | 'call' | 'raise'
  amount?: number
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

/** Chen 公式近似，归一到 0..1（AA≈1，垃圾牌≈0.08）；双人局整体抬一点 */
export function preflopStrength(hole: Card[]): number {
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

  // 双人局：范围更宽，整体抬一点，避免「只有大牌才跟」
  return Math.max(0.08, Math.min(1, score / 18))
}

function countSuit(cards: Card[], suit: Card['suit']) {
  return cards.filter((c) => c.suit === suit).length
}

function holeUsesRank(hole: Card[], rankVal: number) {
  return hole.some((c) => RANK_VAL[c.rank] === rankVal)
}

/** 简易听牌加成：同花听 / 两头顺听 */
function drawBonus(hole: Card[], board: Card[]): number {
  if (board.length < 3 || board.length >= 5) return 0
  const all = [...hole, ...board]
  let bonus = 0

  for (const suit of ['♠', '♥', '♦', '♣'] as const) {
    if (countSuit(all, suit) === 4 && countSuit(hole, suit) >= 1) {
      bonus += 0.22
      break
    }
  }

  const vals = [...new Set(all.map((c) => RANK_VAL[c.rank]))].sort((a, b) => a - b)
  const withA = vals.includes(14) ? [...vals, 1].sort((a, b) => a - b) : vals
  for (let i = 0; i + 3 < withA.length; i++) {
    const slice = withA.slice(i, i + 4)
    if (slice[3] - slice[0] === 3 && new Set(slice).size === 4) {
      bonus += 0.16
      break
    }
  }

  return Math.min(0.32, bonus)
}

/**
 * 牌力 0..1（按双人局校准）。
 * - 翻前：Chen
 * - 翻后：成牌 + 是否用到自己底牌 + 听牌
 * 旧映射会把高牌压到 ~0.2，面对半池注几乎必弃。
 */
export function handStrength(hole: Card[], board: Card[]): number {
  if (hole.length < 2) return 0.25
  if (board.length === 0) return preflopStrength(hole)

  try {
    const hand = bestHand(hole, board)
    const k0 = hand.kickers[0] ?? 7
    const holeHigh = Math.max(RANK_VAL[hole[0].rank], RANK_VAL[hole[1].rank])
    const pairUsesHole = hand.tier === 1 && holeUsesRank(hole, k0)
    const boardPairOnly = hand.tier === 1 && !pairUsesHole

    let base: number
    switch (hand.tier) {
      case 0: {
        // 高牌只看自己底牌，别把公共 K/A 算成自己的摊牌价值
        base = 0.22 + (holeHigh / 14) * 0.28
        break
      }
      case 1:
        if (boardPairOnly) {
          // 只有公共对，实质靠踢脚
          base = 0.34 + (holeHigh / 14) * 0.16
        } else {
          // 自己中对 / 顶对
          base = 0.52 + (k0 / 14) * 0.22
        }
        break
      case 2:
        base = 0.72 + (k0 / 14) * 0.08
        break
      case 3:
        base = 0.82
        break
      case 4:
        base = 0.86
        break
      case 5:
        base = 0.9
        break
      case 6:
        base = 0.94
        break
      default:
        base = 0.98
    }
    return Math.min(1, base + drawBonus(hole, board))
  } catch {
    return 0.4
  }
}

/** 纯决策：可测；rng 注入便于复现 */
export function decidePokerAction(input: {
  hole: Card[]
  board: Card[]
  street: string
  pot: number
  toCall: number
  stack: number
  invested?: number
  alreadyRaised?: boolean
  rng?: () => number
}): PokerBotAction {
  const rng = input.rng ?? Math.random
  const toCall = Math.max(0, input.toCall)
  const stack = Math.max(0, input.stack)
  const pot = Math.max(1, input.pot)
  const street = input.street
  const s = handStrength(input.hole, input.board)
  const alreadyRaised = !!input.alreadyRaised
  const jitter = (rng() - 0.5) * 0.05
  const score = Math.max(0, Math.min(1, s + jitter))
  const invested = Math.max(0, input.invested ?? 0)
  const potShare = invested / Math.max(1, pot)
  const betFrac = toCall / pot

  if (toCall <= 0) {
    if (stack <= 0) return { kind: 'check' }
    const canOpen = !alreadyRaised && stack > BIG_BLIND
    const wantValue = score >= 0.48
    const wantSemi =
      score >= 0.36 && street !== 'river' && rng() < 0.45
    const wantBluff =
      score < 0.36 &&
      rng() < (street === 'preflop' ? 0.28 : street === 'river' ? 0.1 : 0.16)
    if (canOpen && (wantValue || wantSemi || wantBluff)) {
      const mult = score >= 0.78 ? 3 : score >= 0.55 ? 2 : score >= 0.4 ? 2 : 1
      const sized = Math.max(
        BIG_BLIND,
        Math.min(stack, Math.round(pot * (score >= 0.7 ? 0.75 : 0.55))),
      )
      return {
        kind: 'raise',
        amount: Math.min(stack, Math.max(BIG_BLIND * mult, sized)),
      }
    }
    return { kind: 'check' }
  }

  const callAffordable = toCall <= stack
  const potOdds = toCall / (pot + toCall)

  if (score >= 0.62 && !alreadyRaised && stack > toCall + BIG_BLIND) {
    const raiseTo = Math.min(
      stack,
      toCall + Math.max(BIG_BLIND * 2, Math.round(pot * 0.65)),
    )
    if (raiseTo > toCall) return { kind: 'raise', amount: raiseTo }
  }

  if (
    score >= 0.42 &&
    score < 0.62 &&
    !alreadyRaised &&
    street !== 'river' &&
    stack > toCall + BIG_BLIND &&
    betFrac <= 0.7 &&
    rng() < 0.28
  ) {
    return {
      kind: 'raise',
      amount: Math.min(
        stack,
        toCall + Math.max(BIG_BLIND * 2, Math.round(pot * 0.55)),
      ),
    }
  }

  if (!callAffordable) {
    if (
      score >= 0.34 ||
      score + 0.05 >= potOdds ||
      (potShare >= 0.35 && score >= 0.26) ||
      rng() < 0.12
    ) {
      return { kind: 'call' }
    }
    return { kind: 'fold' }
  }

  // 小注：几乎都跟
  if (toCall <= BIG_BLIND * 2 || betFrac <= 0.35) {
    if (score >= 0.16 || rng() < 0.55) return { kind: 'call' }
  }

  // 半池左右
  if (betFrac <= 0.65) {
    if (
      score >= 0.28 ||
      score + 0.02 >= potOdds ||
      (potShare >= 0.28 && score >= 0.2) ||
      (score >= 0.22 && rng() < 0.55)
    ) {
      return { kind: 'call' }
    }
  }

  // 满池级：要成牌/听牌或接近赔率；纯高牌大多弃
  if (betFrac <= 1.15) {
    if (
      score >= 0.48 ||
      score + 0.02 >= potOdds ||
      (potShare >= 0.45 && score >= 0.4) ||
      (score >= 0.38 && rng() < 0.28)
    ) {
      return { kind: 'call' }
    }
  }

  // 超池大注
  if (
    score >= 0.58 ||
    (score >= 0.46 && rng() < 0.18) ||
    (score >= 0.34 && rng() < 0.05)
  ) {
    return { kind: 'call' }
  }

  return { kind: 'fold' }
}

/** 德州 bot：双人局偏松，会跟半池、强牌加压，只有面对大注的垃圾牌才弃 */
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
  let readyToken = 0
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

  function decide(): PokerBotAction {
    if (!pub) return { kind: 'check' }
    const opp: NoteAbout = botWho === 'her' ? 'me' : 'her'
    const toCall = Math.max(0, pub.betThisRound[opp] - pub.betThisRound[botWho])
    return decidePokerAction({
      hole,
      board: pub.board ?? [],
      street: pub.street,
      pot: Math.max(0, pub.pot),
      toCall,
      stack: Math.max(0, pub.stacks[botWho]),
      invested: pub.committed?.[botWho] ?? pub.betThisRound[botWho] ?? 0,
      alreadyRaised: !!pub.raisedThisStreet?.[botWho],
    })
  }

  /** 比牌后确认下一手；整局结束点「再来一局」也要回，否则会卡在「等对方确认」 */
  function scheduleReadyNext() {
    if (!pub || pub.street !== 'showdown') return
    if (pub.readyNext?.[botWho]) return
    const opp: NoteAbout = botWho === 'her' ? 'me' : 'her'
    const peerReady = !!pub.readyNext?.[opp]
    const token = ++readyToken
    const delay = peerReady
      ? 280 + Math.floor(Math.random() * 320)
      : 600 + Math.floor(Math.random() * 500)
    later(delay, () => {
      if (destroyed || token !== readyToken || !pub) return
      if (pub.street !== 'showdown' || pub.readyNext?.[botWho]) return
      pub = {
        ...pub,
        readyNext: {
          her: pub.readyNext?.her ?? false,
          me: pub.readyNext?.me ?? false,
          [botWho]: true,
        },
      }
      reply({ type: 'ready-next', who: botWho })
    })
  }

  function maybeAct() {
    if (!pub) return
    // matchOver 时仍要 ready-next，才能开新一整局
    if (pub.street === 'showdown') {
      scheduleReadyNext()
      return
    }
    if (pub.folded || pub.matchOver) return
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
    readyToken += 1
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
      if (msg.type === 'ready-next') {
        // 人机通常走 state；若收到对方申请则兜底跟确认
        if (msg.who && msg.who !== botWho) scheduleReadyNext()
        return
      }

      if (msg.type === 'deal' || msg.type === 'state') {
        if (!msg.public || typeof msg.public !== 'object') return
        if (msg.public.toAct !== 'her' && msg.public.toAct !== 'me') return
        adoptState(msg.public, msg.holes)
      }
    },
    destroy() {
      destroyed = true
      actToken += 1
      readyToken += 1
      clearTimers()
      replyFn = null
      pub = null
      hole = []
    },
  }
}
