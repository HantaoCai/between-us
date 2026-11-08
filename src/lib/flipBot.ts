import { otherAbout, type NoteAbout } from './notes'
import type { BotDriver, BotReply } from './botRoomSession'

type FlipState = {
  seq: number
  icons: string[]
  matched: boolean[]
  open: number[]
  turn: NoteAbout
  lock: boolean
  done: boolean
}

/** 翻翻乐：sync 含全牌面，人机完美记忆配对 */
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

  function pickPair(): [number, number] | null {
    if (!state) return null
    const openable = state.icons
      .map((_, i) => i)
      .filter((i) => !state!.matched[i])
    if (openable.length < 2) return null
    // 找一对相同 icon
    for (let i = 0; i < openable.length; i++) {
      for (let j = i + 1; j < openable.length; j++) {
        const a = openable[i]!
        const b = openable[j]!
        if (state.icons[a] === state.icons[b]) return [a, b]
      }
    }
    return [openable[0]!, openable[1]!]
  }

  function applyFlipLocal(index: number, by: NoteAbout): 'ok' | 'match' | 'miss' | false {
    if (!state || state.done || state.lock) return false
    if (state.turn !== by) return false
    if (state.matched[index] || state.open.includes(index)) return false
    state.open = [...state.open, index]
    if (state.open.length < 2) return 'ok'
    const [a, b] = state.open
    if (state.icons[a!] === state.icons[b!]) {
      state.matched[a!] = true
      state.matched[b!] = true
      state.open = []
      state.done = state.matched.every(Boolean)
      if (!state.done) state.turn = otherAbout(by)
      return 'match'
    }
    state.lock = true
    return 'miss'
  }

  function applyCloseLocal() {
    if (!state || !state.lock) return
    state.lock = false
    state.open = []
    state.turn = otherAbout(state.turn)
  }

  function scheduleBotTurn() {
    if (!state || state.done || state.lock) return
    if (state.turn !== botWho) return
    const token = ++moveToken
    const pair = pickPair()
    if (!pair) return
    const [a, b] = pair
    later(280 + Math.floor(Math.random() * 220), () => {
      if (destroyed || !state || token !== moveToken) return
      if (state.turn !== botWho || state.lock || state.done) return
      reply({ type: 'flip', seq: state.seq, index: a, by: botWho })
      const first = applyFlipLocal(a, botWho)
      if (first === false) return
      later(220 + Math.floor(Math.random() * 180), () => {
        if (destroyed || !state || token !== moveToken) return
        if (state.turn !== botWho || state.done) return
        reply({ type: 'flip', seq: state.seq, index: b, by: botWho })
        const second = applyFlipLocal(b, botWho)
        if (second === 'miss') {
          later(700, () => {
            if (destroyed || !state || token !== moveToken) return
            reply({ type: 'close', seq: state.seq })
            applyCloseLocal()
          })
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
          !Array.isArray(msg.matched) ||
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
          lock: !!msg.lock && msg.open.length === 2,
          done: msg.matched.every(Boolean),
        }
        moveToken += 1
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
