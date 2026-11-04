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
    let delayTimer = 0
    let pending: RoomSession | null = null

    const cancelDelayedRelease = () => {
      if (delayTimer) {
        window.clearTimeout(delayTimer)
        delayTimer = 0
      }
      pending = null
    }

    // 与 PeerRoomProvider 一致：切后台的 pagehide 不能立刻拆连接
    const releaseOnUnload = (event: PageTransitionEvent | Event) => {
      const persisted =
        'persisted' in event && (event as PageTransitionEvent).persisted
      if (persisted) return
      const snapshot = sessionRef.current
      if (!snapshot || snapshot.peer.destroyed) return
      pending = snapshot
      if (delayTimer) window.clearTimeout(delayTimer)
      delayTimer = window.setTimeout(() => {
        delayTimer = 0
        if (document.visibilityState === 'visible') {
          pending = null
          return
        }
        if (sessionRef.current !== pending) {
          pending = null
          return
        }
        const snap = pending
        pending = null
        if (!snap || snap.peer.destroyed) return
        peerLog('页面长时间在后台，销毁 Peer 释放房号', snap.code)
        sessionRef.current = null
        try {
          snap.destroy()
        } catch {
          /* ignore */
        }
      }, 45000)
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!delayTimer) return
      peerLog('回前台，取消延时销毁连接')
      cancelDelayedRelease()
    }

    window.addEventListener('pagehide', releaseOnUnload)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelDelayedRelease()
      window.removeEventListener('pagehide', releaseOnUnload)
      document.removeEventListener('visibilitychange', onVisible)
      aliveRef.current = false
      const snapshot = sessionRef.current
      window.setTimeout(() => {
        if (aliveRef.current || skipRef.current()) return
        if (sessionRef.current !== snapshot) return
        if (!snapshot || snapshot.peer.destroyed) return
        peerLog('页面卸载，暂存 Peer（不销毁）')
        parkPeerSession(snapshot)
        if (sessionRef.current === snapshot) sessionRef.current = null
      }, 150)
    }
  }, [sessionRef])
}
