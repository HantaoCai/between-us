import type { NoteAbout } from './notes'
import type { BotDriver, BotReply } from './botRoomSession'
import type { ChemistryItem } from './chemistry'

/** 默契问答：人机各自作答（答自己或猜对方），互不等待 */
export function createChemistryBotDriver(opts: {
  botWho: NoteAbout
  playerWho: NoteAbout
}): BotDriver {
  const botWho = opts.botWho
  void opts.playerWho
  let destroyed = false
  let replyFn: BotReply | null = null
  let items: ChemistryItem[] = []
  let lastStartSeq = -1
  const answered = new Set<number>()
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

  function answerAll() {
    items.forEach((item, index) => {
      if (answered.has(index)) return
      answered.add(index)
      const choice = Math.floor(Math.random() * item.options.length)
      later(600 + index * 380 + Math.floor(Math.random() * 900), () => {
        if (destroyed) return
        reply({ type: 'answer', index, choice })
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
        items?: ChemistryItem[]
        seq?: number
      }

      if (msg.type === 'hello') {
        reply({ type: 'hello', who: botWho })
        reply({ type: 'ready' })
        return
      }
      if (msg.type === 'hub-pick' || msg.type === 'hub-return') return
      if (msg.type === 'ready' || msg.type === 'need-start') return
      if (msg.type === 'restart-ask') {
        // 人机直接同意；新题由玩家页（房主）发 start 过来
        if (typeof msg.seq !== 'number') return
        reply({ type: 'restart-ok', seq: msg.seq })
        return
      }

      if (msg.type === 'start') {
        if (!Array.isArray(msg.items) || msg.items.length === 0) return
        // 同步按钮会重发同一个 start：别让机器人重开
        if (typeof msg.seq === 'number') {
          if (msg.seq === lastStartSeq) return
          lastStartSeq = msg.seq
        }
        clearTimers()
        items = msg.items
        answered.clear()
        answerAll()
        return
      }

      // 玩家答题不阻塞机器人；开局已各自答
    },
    destroy() {
      destroyed = true
      clearTimers()
      replyFn = null
      items = []
      answered.clear()
    },
  }
}
