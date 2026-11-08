import type { NoteAbout } from './notes'
import type { BotDriver, BotReply } from './botRoomSession'

/** 大厅握手用：只回 hello，具体游戏进页后会换专用 Driver */
export function createHubBotDriver(opts: {
  botWho: NoteAbout
  playerWho: NoteAbout
}): BotDriver {
  const botWho = opts.botWho
  void opts.playerWho
  let destroyed = false
  let replyFn: BotReply | null = null

  function reply(data: unknown) {
    if (destroyed || !replyFn) return
    replyFn(data)
  }

  return {
    onFromPlayer(raw, replyToPlayer) {
      if (destroyed) return
      replyFn = replyToPlayer
      if (!raw || typeof raw !== 'object' || !('type' in raw)) return
      const msg = raw as { type: string }
      if (msg.type === 'hello') {
        reply({ type: 'hello', who: botWho })
        return
      }
    },
    destroy() {
      destroyed = true
      replyFn = null
    },
  }
}
