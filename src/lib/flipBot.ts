import { otherAbout, type NoteAbout } from './notes'
import type { BotDriver, BotReply } from './botRoomSession'
import {
  emptyFlipScores,
  FLIP_COUNT,
  flipEffectSeed,
  nextTurnAfterClose,
  pickPeekIndices,
  pointsForMatch,
  remainingPairs,
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

/** 翻翻乐人机：只记翻过/偷窥过的牌，不偷看全盘；跟随计分连击特殊牌 */
export function createFlipBotDriver(opts: {
  botWho: NoteAbout
  playerWho: NoteAbout
}): BotDriver {
  const botWho = opts.botWho
  let destroyed = false
  let replyFn: BotReply | null = null
  let state: FlipState | null = null
  /** 只记见过的牌面，不把 sync 全盘写进记忆 */
  let memory = new Map<number, string>()
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

  function remember(index: number) {
    if (!state) return
    const icon = state.icons[index]
    if (icon) memory.set(index, icon)
  }

  function rememberMany(indices: number[]) {
    for (const i of indices) remember(i)
  }

  function forgetUnmatchedMemory() {
    if (!state) {
      memory.clear()
      return
    }
    for (const i of [...memory.keys()]) {
      if (!state.matched[i]) memory.delete(i)
    }
  }

  function pairPriority(icon: string): number {
    if (icon === SPECIAL_BOMB) return 3
    if (icon === SPECIAL_PEEK) return 2
    if (icon === SPECIAL_SHUFFLE) return 1
    return 0
  }

  function openableIndices(): number[] {
    if (!state) return []
    return state.icons
      .map((_, i) => i)
      .filter((i) => !state!.matched[i] && !state!.open.includes(i))
  }

  /** 记忆里已凑齐的一对，优先特殊牌 */
  function knownPair(): [number, number] | null {
    if (!state) return null
    const openable = new Set(openableIndices())
    const byIcon = new Map<string, number[]>()
    for (const [i, icon] of memory) {
      if (!openable.has(i)) continue
      const list = byIcon.get(icon) ?? []
      list.push(i)
      byIcon.set(icon, list)
    }
    let best: [number, number] | null = null
    let bestPri = -1
    for (const [icon, idxs] of byIcon) {
      if (idxs.length < 2) continue
      const pri = pairPriority(icon)
      if (pri > bestPri) {
        bestPri = pri
        best = [idxs[0]!, idxs[1]!]
      }
    }
    return best
  }

  function pickFirst(): number | null {
    if (!state) return null
    const known = knownPair()
    if (known) return known[0]

    const openable = openableIndices()
    if (openable.length === 0) return null
    const unknown = openable.filter((i) => !memory.has(i))
    const pool = unknown.length > 0 ? unknown : openable
    return pool[Math.floor(Math.random() * pool.length)]!
  }

  function pickSecond(first: number): number | null {
    if (!state) return null
    const openable = openableIndices().filter((i) => i !== first)
    if (openable.length === 0) return null

    const face = memory.get(first) ?? state.icons[first]
    if (face) {
      const mate = openable.find((i) => memory.get(i) === face)
      if (mate !== undefined) return mate
    }

    const unknown = openable.filter((i) => !memory.has(i))
    if (unknown.length > 0) {
      return unknown[Math.floor(Math.random() * unknown.length)]!
    }
    return openable[Math.floor(Math.random() * openable.length)]!
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
        rememberMany(indices)
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
      forgetUnmatchedMemory()
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
    remember(index)
    if (state.open.length < 2) return 'ok'

    state.moves += 1
    const [a, b] = state.open
    remember(a!)
    remember(b!)
    if (state.icons[a!] === state.icons[b!]) {
      const icon = state.icons[a!]!
      state.streak += 1
      const pairsLeft = remainingPairs(state.matched)
      state.scores = {
        ...state.scores,
        [by]: state.scores[by] + pointsForMatch(icon, state.streak, pairsLeft),
      }
      state.matched[a!] = true
      state.matched[b!] = true
      memory.delete(a!)
      memory.delete(b!)
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
    rememberMany(state.peek)
    state.peek = []
    state.lock = false
  }

  function scheduleBotTurn() {
    if (!state || state.done || state.lock) return
    if (state.peek.length > 0) return
    if (state.turn !== botWho) return
    const token = ++moveToken
    const first = pickFirst()
    if (first === null) return

    later(300 + Math.floor(Math.random() * 280), () => {
      if (destroyed || !state || token !== moveToken) return
      if (state.turn !== botWho || state.lock || state.done || state.peek.length) return
      reply({ type: 'flip', seq: state.seq, index: first, by: botWho })
      const firstResult = applyFlipLocal(first, botWho)
      if (firstResult === false) return

      later(260 + Math.floor(Math.random() * 240), () => {
        if (destroyed || !state || token !== moveToken) return
        if (state.turn !== botWho || state.done || state.peek.length) return
        const second = pickSecond(first)
        if (second === null) return
        reply({ type: 'flip', seq: state.seq, index: second, by: botWho })
        const secondResult = applyFlipLocal(second, botWho)
        if (secondResult === 'miss') {
          later(700, () => {
            if (destroyed || !state || token !== moveToken) return
            reply({ type: 'close', seq: state.seq })
            applyCloseLocal()
            scheduleBotTurn()
          })
          return
        }
        if (secondResult === 'match' && !state.done) {
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
        const nextPeek = Array.isArray(msg.peek) ? msg.peek.slice() : []
        const freshDeal = !state || msg.seq !== state.seq
        state = {
          seq: msg.seq,
          icons: msg.icons.slice(),
          matched: msg.matched.slice(),
          open: msg.open.slice(),
          turn: msg.turn,
          lock: !!msg.lock || nextPeek.length > 0,
          done: msg.matched.every(Boolean),
          moves: typeof msg.moves === 'number' ? msg.moves : 0,
          scores: msg.scores ? { ...msg.scores } : emptyFlipScores(),
          streak: typeof msg.streak === 'number' ? msg.streak : 0,
          skip: msg.skip === 'her' || msg.skip === 'me' ? msg.skip : null,
          peek: nextPeek,
        }
        if (freshDeal) memory.clear()
        // 只记当前亮着的牌，不把整副写进记忆
        rememberMany(state.open)
        rememberMany(state.peek)
        for (let i = 0; i < state.matched.length; i++) {
          if (state.matched[i]) memory.delete(i)
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
      memory.clear()
    },
  }
}
