import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  readPeerRoom,
  type PeerGameId,
  type SavedPeerRoom,
} from './peerRoomSave'

/**
 * 进入对应游戏页时，若本地有未结束房间则自动重连。
 * ?fresh=1 表示要开新局，跳过自动恢复。
 */
export function useResumePeerRoom(
  game: PeerGameId,
  resume: (saved: SavedPeerRoom) => void,
) {
  const [params, setParams] = useSearchParams()
  const started = useRef(false)
  const resumeRef = useRef(resume)
  resumeRef.current = resume

  useEffect(() => {
    if (started.current) return
    if (params.get('fresh') === '1') {
      started.current = true
      setParams({}, { replace: true })
      return
    }
    const saved = readPeerRoom()
    if (!saved || saved.game !== game) return
    started.current = true
    if (params.get('resume') === '1') {
      setParams({}, { replace: true })
    }
    resumeRef.current(saved)
  }, [game, params, setParams])
}
