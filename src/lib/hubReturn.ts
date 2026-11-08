import type { NavigateFunction } from 'react-router-dom'
import type { NoteAbout } from './notes'
import {
  isPeerPlayGame,
  savePlayPeerRoom,
  type PeerPlayGameId,
} from './peerRoomSave'
import { setSoloRoomPresenceGame } from './peerRoomsApi'

/**
 * 回「已开房、选游戏」大厅。
 * Peer 由 PeerRoomProvider 跨页持有，这里只改存档并跳转，不拆连接。
 * 同房号的 poker/guess/gomoku payload 由 savePeerRoom 自动保留。
 */
export async function returnToGameHub(options: {
  session?: { destroy?: () => void } | null
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
  navigate: NavigateFunction
  /** 自己离开时记下刚才那局，大厅可「继续游戏」 */
  parkedGame?: PeerPlayGameId | null
  mode?: 'peer' | 'solo'
}): Promise<void> {
  const { code, role, who, navigate, parkedGame, mode } = options

  if (!code) {
    navigate('/games', { replace: true })
    return
  }

  savePlayPeerRoom({
    game: 'hub',
    code,
    role,
    who,
    mode,
    parkedGame:
      parkedGame && isPeerPlayGame(parkedGame) ? parkedGame : null,
  })

  if (mode === 'solo') setSoloRoomPresenceGame(null)

  navigate('/games?resume=1', { replace: true })
}
