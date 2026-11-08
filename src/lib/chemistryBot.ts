import type { NoteAbout } from './notes'
import type { BotDriver, BotReply } from './botRoomSession'
import type { ChemistryItem } from './chemistry'

/** 默契问答：同题作答；常跟玩家选项以提高合拍感 */
export function createChemistryBotDriver(opts: {
  botWho: NoteAbout
  playerWho: NoteAbout
}): BotDriver {
  const botWho = opts.botWho
  void opts.playerWho
  let destroyed = false
  let replyFn: BotReply | null = null
  let items: ChemistryItem[] = []
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

  function answer(index: number, prefer?: number) {
    const item = items[index]
    if (!item || answered.has(index)) return
    answered.add(index)
    let choice: number
    if (
      typeof prefer === 'number' &&
      prefer >= 0 &&
      prefer < item.options.length &&
      Math.random() < 0.55
    ) {
      choice = prefer
    } else {
      choice = Math.floor(Math.random() * item.options.length)
    }
    later(500 + Math.floor(Math.random() * 1400), () => {
      if (destroyed) return
      reply({ type: 'answer', index, choice })
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
        index?: number
        choice?: number
      }

      if (msg.type === 'hello') {
        reply({ type: 'hello', who: botWho })
        reply({ type: 'ready' })
        return
      }
      if (msg.type === 'hub-pick' || msg.type === 'hub-return') return
      if (msg.type === 'ready' || msg.type === 'need-start') return

      if (msg.type === 'start') {
        if (!Array.isArray(msg.items) || msg.items.length === 0) return
        clearTimers()
        items = msg.items
        answered.clear()
        return
      }

      if (msg.type === 'answer') {
        if (typeof msg.index !== 'number' || typeof msg.choice !== 'number') return
        answer(msg.index, msg.choice)
      }
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
