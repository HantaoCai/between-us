import {
  createBotRoomSession,
  SOLO_ROOM_CODE,
  type BotDriver,
} from './botRoomSession'
import { otherAbout, type NoteAbout } from './notes'
import type { RoomSession } from './peerRoom'
import { clearPeerHandoff } from './peerHandoff'

type SoloRoomApi = {
  destroySession: () => void
  attachSession: (session: RoomSession, meta?: { who?: NoteAbout }) => void
  setWho: (who: NoteAbout) => void
  setPeerWho: (who: NoteAbout | null) => void
}

/** 销毁旧会话并挂上人机 Bot；调用方再 bindHandlers */
export function mountSoloBotSession(opts: {
  room: SoloRoomApi
  driver: BotDriver
  playerWho: NoteAbout
  code?: string
  /** 默认会 attachSession；若页面稍后自行 attach 可关掉 */
  attach?: boolean
}): { session: RoomSession; botWho: NoteAbout; playerWho: NoteAbout } {
  clearPeerHandoff()
  opts.room.destroySession()
  const playerWho = opts.playerWho
  const botWho = otherAbout(playerWho)
  const session = createBotRoomSession({
    code: opts.code || SOLO_ROOM_CODE,
    driver: opts.driver,
  })
  opts.room.setWho(playerWho)
  opts.room.setPeerWho(botWho)
  if (opts.attach !== false) {
    opts.room.attachSession(session, { who: playerWho })
  }
  return { session, botWho, playerWho }
}
