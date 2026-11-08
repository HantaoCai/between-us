import { bestHand, BIG_BLIND, type Card } from './poker'
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

/** 德州简易 bot：旁路 deal/state，轮到自己 fold/check/call/min-raise */
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

  function strength(): number {
    if (hole.length < 2) return 0
    try {
      const hand = bestHand(hole, pub?.board ?? [])
      // tier 越高越好；归一到大概 0..1
      return Math.min(1, hand.tier / 9)
    } catch {
      return 0.3
    }
  }

  function decide(): { kind: 'fold' | 'check' | 'call' | 'raise'; amount?: number } {
    if (!pub) return { kind: 'check' }
    const opp: NoteAbout = botWho === 'her' ? 'me' : 'her'
    const toCall = Math.max(0, pub.betThisRound[opp] - pub.betThisRound[botWho])
    const stack = Math.max(0, pub.stacks[botWho])
    const s = strength()
    const alreadyRaised = !!pub.raisedThisStreet?.[botWho]

    if (toCall <= 0) {
      if (s >= 0.55 && !alreadyRaised && stack > BIG_BLIND) {
        return { kind: 'raise', amount: Math.min(stack, toCall + BIG_BLIND * (s > 0.75 ? 3 : 1)) }
      }
      return { kind: 'check' }
    }

    if (s < 0.28 && toCall > BIG_BLIND) return { kind: 'fold' }
    if (s < 0.35 && toCall > stack * 0.35) return { kind: 'fold' }
    if (s >= 0.7 && !alreadyRaised && stack > toCall + BIG_BLIND) {
      return {
        kind: 'raise',
        amount: Math.min(stack, toCall + BIG_BLIND * 2),
      }
    }
    return { kind: 'call' }
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
