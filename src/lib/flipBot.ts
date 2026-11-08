import { otherAbout, type NoteAbout } from './notes'
import type { BotDriver, BotReply } from './botRoomSession'
import {
  emptyFlipScores,
  FLIP_COUNT,
  flipEffectSeed,
  nextTurnAfterClose,
  pickPeekIndices,
  pointsForMatch,
  shuffleUnmatchedIcons,
  SPECIAL_BOMB,
  SPECIAL_PEEK,
  SPECIAL_SHUFFLE,
  type FlipScores,
} from './flipGame'

type FlipState = {
  seq: number
  icons: string[]
  matched: boolean[]
  open: number[]
  turn: NoteAbout
  lock: boolean
  done: boolean
  moves: number
  scores: FlipScores
  streak: number
  skip: NoteAbout | null
  peek: number[]
}

const PEEK_MS = 1400

/** 翻翻乐人机：跟随 6×6 / 计分 / 连击 / 特殊牌规则 */
export function createFlipBotDriver(opts: {
  botWho: NoteAbout
  playerWho: NoteAbout
}): BotDriver {
  const botWho = opts.botWho
  let destroyed = false
  let replyFn: BotReply | null = null
  let state: FlipState | null = null
  let moveToken = 0
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

  function pairPriority(icon: string): number {
    if (icon === SPECIAL_BOMB) return 3
    if (icon === SPECIAL_PEEK) return 2
    if (icon === SPECIAL_SHUFFLE) return 1
    return 0
  }

  function pickPair(): [number, number] | null {
    if (!state) return null
    const openable = state.icons
      .map((_, i) => i)
      .filter((i) => !state!.matched[i])
    if (openable.length < 2) return null

    let best: [number, number] | null = null
    let bestPri = -1
    for (let i = 0; i < openable.length; i++) {
      for (let j = i + 1; j < openable.length; j++) {
        const a = openable[i]!
        const b = openable[j]!
        if (state.icons[a] !== state.icons[b]) continue
        const pri = pairPriority(state.icons[a]!)
        if (pri > bestPri) {
          bestPri = pri
          best = [a, b]
        }
      }
    }
    if (best) return best
    return [openable[0]!, openable[1]!]
  }

  function applySpecial(icon: string, by: NoteAbout) {
    if (!state) return
    const matchedCount = state.matched.filter(Boolean).length
    const seed = flipEffectSeed(state.seq, state.moves, matchedCount)

    if (icon === SPECIAL_PEEK) {
      const indices = pickPeekIndices(state.matched, seed, 2)
      if (indices.length > 0) {
        state.peek = indices
        state.lock = true
        const seq = state.seq
        later(PEEK_MS, () => {
          if (!state || state.seq !== seq) return
          state.peek = []
          state.lock = false
          scheduleBotTurn()
        })
      }
      return
    }

    if (icon === SPECIAL_SHUFFLE) {
      state.icons = shuffleUnmatchedIcons(state.icons, state.matched, seed)
      return
    }

    if (icon === SPECIAL_BOMB) {
      state.skip = otherAbout(by)
    }
  }

  function applyFlipLocal(index: number, by: NoteAbout): 'ok' | 'match' | 'miss' | false {
    if (!state || state.done || state.lock) return false
    if (state.peek.length > 0) return false
    if (state.turn !== by) return false
    if (state.matched[index] || state.open.includes(index)) return false
    state.open = [...state.open, index]
    if (state.open.length < 2) return 'ok'

    state.moves += 1
    const [a, b] = state.open
    if (state.icons[a!] === state.icons[b!]) {
      const icon = state.icons[a!]!
      state.streak += 1
      state.scores = {
        ...state.scores,
        [by]: state.scores[by] + pointsForMatch(icon, state.streak),
      }
      state.matched[a!] = true
      state.matched[b!] = true
      state.open = []
      state.done = state.matched.every(Boolean)
      if (!state.done) applySpecial(icon, by)
      return 'match'
    }

    state.streak = 0
    state.lock = true
    return 'miss'
  }

  function applyCloseLocal() {
    if (!state || !state.lock) return
    if (state.peek.length > 0) return
    state.lock = false
    state.open = []
    state.streak = 0
    const stepped = nextTurnAfterClose(state.turn, state.skip)
    state.skip = stepped.skip
    state.turn = stepped.turn
  }

  function applyPeekEndLocal() {
    if (!state || state.peek.length === 0) return
    state.peek = []
    state.lock = false
  }

  function scheduleBotTurn() {
    if (!state || state.done || state.lock) return
    if (state.peek.length > 0) return
    if (state.turn !== botWho) return
    const token = ++moveToken
    const pair = pickPair()
    if (!pair) return
    const [a, b] = pair
    later(280 + Math.floor(Math.random() * 220), () => {
      if (destroyed || !state || token !== moveToken) return
      if (state.turn !== botWho || state.lock || state.done || state.peek.length) return
      reply({ type: 'flip', seq: state.seq, index: a, by: botWho })
      const first = applyFlipLocal(a, botWho)
      if (first === false) return
      later(220 + Math.floor(Math.random() * 180), () => {
        if (destroyed || !state || token !== moveToken) return
        if (state.turn !== botWho || state.done || state.peek.length) return
        reply({ type: 'flip', seq: state.seq, index: b, by: botWho })
        const second = applyFlipLocal(b, botWho)
        if (second === 'miss') {
          later(700, () => {
            if (destroyed || !state || token !== moveToken) return
            reply({ type: 'close', seq: state.seq })
            applyCloseLocal()
            scheduleBotTurn()
          })
          return
        }
        if (second === 'match' && !state.done) {
          // 连击继续；若偷窥中则等 peek 结束
          if (state.peek.length === 0) scheduleBotTurn()
        }
      })
    })
  }

  return {
    onFromPlayer(raw, replyToPlayer) {
      if (destroyed) return
      replyFn = replyToPlayer
      if (!raw || typeof raw !== 'object' || !('type' in raw)) return
      const msg = raw as {
        type: string
        who?: NoteAbout
        seq?: number
        icons?: string[]
        matched?: boolean[]
        open?: number[]
        turn?: NoteAbout
        lock?: boolean
        index?: number
        by?: NoteAbout
        moves?: number
        scores?: FlipScores
        skip?: NoteAbout | null
        streak?: number
        peek?: number[]
      }

      if (msg.type === 'hello') {
        reply({ type: 'hello', who: botWho })
        reply({ type: 'need-start' })
        return
      }
      if (msg.type === 'hub-pick' || msg.type === 'hub-return') return
      if (msg.type === 'need-start') return

      if (msg.type === 'sync') {
        if (
          typeof msg.seq !== 'number' ||
          !Array.isArray(msg.icons) ||
          msg.icons.length !== FLIP_COUNT ||
          !Array.isArray(msg.matched) ||
          msg.matched.length !== FLIP_COUNT ||
          !Array.isArray(msg.open) ||
          (msg.turn !== 'her' && msg.turn !== 'me')
        ) {
          return
        }
        state = {
          seq: msg.seq,
          icons: msg.icons.slice(),
          matched: msg.matched.slice(),
          open: msg.open.slice(),
          turn: msg.turn,
          lock: !!msg.lock || (Array.isArray(msg.peek) && msg.peek.length > 0),
          done: msg.matched.every(Boolean),
          moves: typeof msg.moves === 'number' ? msg.moves : 0,
          scores: msg.scores ? { ...msg.scores } : emptyFlipScores(),
          streak: typeof msg.streak === 'number' ? msg.streak : 0,
          skip: msg.skip === 'her' || msg.skip === 'me' ? msg.skip : null,
          peek: Array.isArray(msg.peek) ? msg.peek.slice() : [],
        }
        moveToken += 1
        if (state.peek.length > 0) {
          const seq = state.seq
          later(PEEK_MS, () => {
            if (!state || state.seq !== seq) return
            applyPeekEndLocal()
            scheduleBotTurn()
          })
          return
        }
        scheduleBotTurn()
        return
      }

      if (msg.type === 'flip') {
        if (!state || typeof msg.index !== 'number' || (msg.by !== 'her' && msg.by !== 'me')) {
          return
        }
        if (msg.seq !== state.seq) return
        if (msg.by === botWho) return
        applyFlipLocal(msg.index, msg.by)
        scheduleBotTurn()
        return
      }

      if (msg.type === 'close') {
        if (!state || typeof msg.seq !== 'number' || msg.seq !== state.seq) return
        applyCloseLocal()
        scheduleBotTurn()
        return
      }

      if (msg.type === 'peek-end') {
        if (!state || typeof msg.seq !== 'number' || msg.seq !== state.seq) return
        applyPeekEndLocal()
        scheduleBotTurn()
      }
    },
    destroy() {
      destroyed = true
      clearTimers()
      moveToken += 1
      replyFn = null
      state = null
    },
  }
}
