import type { NoteAbout } from './notes'
import type { BotDriver, BotReply } from './botRoomSession'
import type { QuizItem } from './quizBank'

/** 答题：收 start 后按自己的节奏作答 */
export function createQuizBotDriver(opts: {
  botWho: NoteAbout
  playerWho: NoteAbout
}): BotDriver {
  const botWho = opts.botWho
  void opts.playerWho
  let destroyed = false
  let replyFn: BotReply | null = null
  let timers: number[] = []
  let roundToken = 0
  let lastStartSeq = -1

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

  function choose(item: QuizItem): number {
    if (Math.random() < 0.72) return item.answer
    const wrong = [0, 1, 2, 3].filter((i) => i !== item.answer)
    return wrong[Math.floor(Math.random() * wrong.length)] ?? 0
  }

  function playRound(items: QuizItem[]) {
    const token = ++roundToken
    clearTimers()
    let delay = 0
    items.forEach((item, index) => {
      const ms = 900 + Math.floor(Math.random() * 2800)
      delay += ms
      later(delay, () => {
        if (destroyed || token !== roundToken) return
        reply({ type: 'answer', index, choice: choose(item), ms })
        if (index === items.length - 1) {
          later(180, () => {
            if (destroyed || token !== roundToken) return
            reply({ type: 'finished' })
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
      const msg = raw as { type: string; items?: QuizItem[]; seq?: number }

      if (msg.type === 'hello') {
        reply({ type: 'hello', who: botWho })
        reply({ type: 'ready' })
        return
      }
      if (msg.type === 'hub-pick' || msg.type === 'hub-return') return
      if (msg.type === 'restart-ask') {
        // 人机直接同意；新题由玩家页（房主）发 start 过来
        if (typeof msg.seq !== 'number') return
        reply({ type: 'restart-ok', seq: msg.seq })
        return
      }
      if (
        msg.type === 'ready' ||
        msg.type === 'need-start' ||
        msg.type === 'answer' ||
        msg.type === 'finished'
      ) {
        return
      }

      if (msg.type === 'start') {
        if (!Array.isArray(msg.items) || msg.items.length === 0) return
        // 同步按钮会重发同一个 start：别让机器人从头再答
        if (typeof msg.seq === 'number') {
          if (msg.seq === lastStartSeq) return
          lastStartSeq = msg.seq
        }
        playRound(msg.items)
      }
    },
    destroy() {
      destroyed = true
      roundToken += 1
      clearTimers()
      replyFn = null
    },
  }
}
