import type { NavigateFunction } from 'react-router-dom'
import type { NoteAbout } from './notes'
import { savePeerRoom } from './peerRoomSave'

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
}): Promise<void> {
  const { code, role, who, navigate } = options

  if (!code) {
    navigate('/games', { replace: true })
    return
  }

  savePeerRoom({
    game: 'hub',
    code,
    role,
    who,
  })

  navigate('/games?resume=1', { replace: true })
}
