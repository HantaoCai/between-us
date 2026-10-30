import type { NavigateFunction } from 'react-router-dom'
import type { NoteAbout } from './notes'
import { savePeerRoom } from './peerRoomSave'

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

type HubSession = {
  isHost: boolean
  destroy: () => void
}

/**
 * 自己回「已开房、选游戏」大厅。
 * 不通知对方——一发信对方容易弹窗/断线；两边各自点返回即可。
 */
export async function returnToGameHub(options: {
  session: HubSession | null
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
  navigate: NavigateFunction
}): Promise<void> {
  const { session, code, role, who, navigate } = options

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

  try {
    session?.destroy()
  } catch {
    /* ignore */
  }

  // 同号 Peer 释放一下再占
  await sleep(role === 'host' ? 600 : 1200)
  navigate('/games?resume=1', { replace: true })
}
