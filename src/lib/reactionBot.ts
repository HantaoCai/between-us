import type { NoteAbout } from './notes'
import type { BotDriver, BotReply } from './botRoomSession'

const WIN = 5

type Score = Record<NoteAbout, number>

/** 反应速度：跟 ready，收 arm 后延迟合法 tap */
export function createReactionBotDriver(opts: {
  botWho: NoteAbout
  playerWho: NoteAbout
}): BotDriver {
  const botWho = opts.botWho
  let destroyed = false
  let replyFn: BotReply | null = null
  let score: Score = { her: 0, me: 0 }
  let round = 0
  let finished = false
  let armToken = 0
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

  function helloBack() {
    reply({
      type: 'hello',
      who: botWho,
      her: score.her,
      me: score.me,
      round,
      finished,
      busy: false,
    })
  }

  function scheduleTap(r: number, delay: number) {
    const token = ++armToken
    const foul = Math.random() < 0.06
    if (foul) {
      later(Math.max(200, delay - 80 - Math.floor(Math.random() * 200)), () => {
        if (destroyed || token !== armToken || finished) return
        reply({ type: 'tap', round: r, foul: true })
      })
      return
    }
    const reactMs = 180 + Math.floor(Math.random() * 220)
    later(delay + reactMs, () => {
      if (destroyed || token !== armToken || finished) return
      reply({
        type: 'tap',
        round: r,
        foul: false,
        ms: reactMs + Math.floor(Math.random() * 40),
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
        round?: number
        delay?: number
        foul?: boolean
        ms?: number
        seq?: number
        her?: number
        me?: number
      }

      if (msg.type === 'hello') {
        helloBack()
        return
      }
      if (msg.type === 'hub-pick' || msg.type === 'hub-return') return

      if (msg.type === 'ready') {
        if (typeof msg.round !== 'number' || msg.round < 1) return
        round = msg.round
        later(120 + Math.floor(Math.random() * 180), () => {
          if (destroyed || finished) return
          reply({ type: 'ready', round: msg.round })
        })
        return
      }

      if (msg.type === 'arm') {
        if (typeof msg.round !== 'number' || typeof msg.delay !== 'number') return
        if (msg.delay < 500 || msg.delay > 8000) return
        round = msg.round
        scheduleTap(msg.round, msg.delay)
        return
      }

      if (msg.type === 'tap') {
        // 人的 tap：粗略更新比分感（终局以玩家页为准）
        if (typeof msg.round !== 'number') return
        return
      }

      if (msg.type === 'again') {
        if (typeof msg.seq !== 'number') return
        clearTimers()
        armToken += 1
        score = { her: 0, me: 0 }
        round = 0
        finished = false
        helloBack()
      }
    },
    destroy() {
      destroyed = true
      clearTimers()
      replyFn = null
      void WIN
    },
  }
}
