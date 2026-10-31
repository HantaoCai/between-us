import { useEffect, useRef, type MutableRefObject } from 'react'
import { parkPeerSession } from './peerHandoff'
import { peerLog } from './peerLog'
import type { RoomSession } from './peerRoom'

/**
 * 离开对局页时不拆 Peer，只暂存；StrictMode 误卸载也能接回。
 * 回大厅移交时先把 sessionRef 置空，或让 skip() 返回 true。
 */
export function usePeerSessionGuard(
  sessionRef: MutableRefObject<RoomSession | null>,
  skip: () => boolean,
) {
  const aliveRef = useRef(true)
  const skipRef = useRef(skip)
  skipRef.current = skip

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      const snapshot = sessionRef.current
      window.setTimeout(() => {
        if (aliveRef.current || skipRef.current()) return
        if (sessionRef.current !== snapshot) return
        if (!snapshot) return
        peerLog('页面卸载，暂存 Peer（不销毁）')
        parkPeerSession(snapshot)
        if (sessionRef.current === snapshot) sessionRef.current = null
      }, 150)
    }
  }, [sessionRef])
}
