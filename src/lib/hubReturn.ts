import type { NavigateFunction } from 'react-router-dom'
import type { NoteAbout } from './notes'
import {
  isPeerPlayGame,
  savePeerRoom,
  type PeerPlayGameId,
} from './peerRoomSave'

/**
 * 回「已开房、选游戏」大厅。
 * Peer 由 PeerRoomProvider 跨页持有，这里只改存档并跳转，不拆连接。
 */
export async function returnToGameHub(options: {
  session?: { destroy?: () => void } | null
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
  navigate: NavigateFunction
  /** 自己离开时记下刚才那局，大厅可「继续游戏」 */
  parkedGame?: PeerPlayGameId | null
}): Promise<void> {
  const { code, role, who, navigate, parkedGame } = options

  if (!code) {
    navigate('/games', { replace: true })
    return
  }

  savePeerRoom({
    game: 'hub',
    code,
    role,
    who,
    parkedGame:
      parkedGame && isPeerPlayGame(parkedGame) ? parkedGame : null,
  })

  navigate('/games?resume=1', { replace: true })
}
