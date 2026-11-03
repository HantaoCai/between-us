import type { RoomHandlers, RoomSession } from './peerRoom'
import { QUIET_HANDLERS } from './peerRoom'

export const SOLO_ROOM_CODE = 'solo01'

export function isSoloRoomCode(code: string | null | undefined): boolean {
  return !!code && /^solo\d{2}$/i.test(code)
}

export type BotReply = (data: unknown, times?: number) => void

export type BotDriver = {
  /** 玩家发出的每条业务消息 */
  onFromPlayer: (data: unknown, reply: BotReply) => void
  destroy?: () => void
}

type HandlerBag = { current: RoomHandlers }

/** 本地假 Peer：不连 WebRTC，把发出的消息交给 BotDriver */
export function createBotRoomSession(opts: {
  code?: string
  driver: BotDriver
}): RoomSession {
  const code = opts.code || SOLO_ROOM_CODE
  const bag: HandlerBag = { current: QUIET_HANDLERS }
  let dead = false
  const pending: unknown[] = []

  const link = { open: true }

  function deliverToPlayer(data: unknown) {
    if (dead) return
    try {
      bag.current.onData(data)
    } catch {
      /* ignore bot → UI errors */
    }
  }

  const reply: BotReply = (data) => {
    // 下一帧再回，模拟网络延迟、避免同步重入
    window.setTimeout(() => deliverToPlayer(data), 0)
  }

  function emitFromPlayer(data: unknown) {
    if (dead) return
    if (!data || typeof data !== 'object') return
    // 内部心跳忽略
    const t = (data as { type?: string }).type
    if (t === '__ping' || t === '__pong' || t === '__room-full') return
    try {
      opts.driver.onFromPlayer(data, reply)
    } catch {
      /* ignore */
    }
  }

  const session: RoomSession = {
    code,
    peer: { destroyed: false },
    conn: link,
    isHost: true,
    send(data) {
      emitFromPlayer(data)
    },
    sendReliable(data, times = 3) {
      const n = Math.max(1, times)
      // 人机只处理一次，避免 Bot 重复落子
      emitFromPlayer(data)
      void n
      void pending
    },
    setHandlers(handlers) {
      bag.current = handlers
      if (link.open) {
        window.setTimeout(() => {
          if (dead) return
          bag.current.onOpen?.()
        }, 0)
      }
    },
    destroy() {
      if (dead) return
      dead = true
      link.open = false
      try {
        opts.driver.destroy?.()
      } catch {
        /* ignore */
      }
      bag.current = QUIET_HANDLERS
    },
  }

  return session
}
