import { useEffect, useRef } from 'react'
import { usePeerRoom } from './PeerRoomContext'
import { peerLog } from './peerLog'
import {
  isPeerPlayGame,
  readPeerRoom,
  type PeerGameId,
  type SavedPeerRoom,
} from './peerRoomSave'
import { useResumePeerRoom } from './useResumePeerRoom'

/**
 * 大厅选游戏进来：Provider 已有连接 → 只 onLive 换绑回调。
 * 刷新冷启动：无 Provider 会话才走 onResume 重建。
 */
export function useGamePeerBoot(
  game: PeerGameId,
  onLive: () => void,
  onResume: (saved: SavedPeerRoom) => void,
) {
  const room = usePeerRoom()
  const liveRef = useRef(onLive)
  const resumeRef = useRef(onResume)
  const sendRef = useRef(room.sendReliable)
  liveRef.current = onLive
  resumeRef.current = onResume
  sendRef.current = room.sendReliable
  const bootedRef = useRef(false)

  useEffect(() => {
    if (bootedRef.current) return
    if (!room.session) return
    bootedRef.current = true
    liveRef.current()
    // 房主进桌后再补广播：对方若漏了大厅那一波 hub-pick，还能跟进来
    if (room.isHost && isPeerPlayGame(game)) {
      peerLog('进桌后补发 hub-pick', game)
      const pick = { type: 'hub-pick', game }
      for (let i = 0; i < 5; i++) {
        window.setTimeout(() => sendRef.current(pick, 3), 100 * i)
      }
    }
  }, [room.session, room.isHost, game])

  useResumePeerRoom(game, (saved) => {
    if (room.session || bootedRef.current) return
    // 再读一次：可能同 tick 里 onLive 已占用
    if (readPeerRoom()?.game !== game) return
    bootedRef.current = true
    resumeRef.current(saved)
  })
}
