import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Outlet } from 'react-router-dom'
import { parkPeerSession } from './peerHandoff'
import { peerLog } from './peerLog'
import {
  QUIET_HANDLERS,
  type RoomHandlers,
  type RoomSession,
} from './peerRoom'
import type { NoteAbout } from './notes'

type PeerRoomValue = {
  session: RoomSession | null
  code: string
  who: NoteAbout
  isHost: boolean
  isSpectator: boolean
  peerWho: NoteAbout | null
  setWho: (who: NoteAbout) => void
  setPeerWho: (who: NoteAbout | null) => void
  setSpectator: (next: boolean) => void
  /** 挂上/换掉当前房间会话（进房成功时调用） */
  attachSession: (session: RoomSession, meta?: { who?: NoteAbout }) => void
  /** 只换回调，不拆 Peer——大厅 ↔ 游戏切换用这个 */
  bindHandlers: (handlers: RoomHandlers) => void
  /** 主动离开房间才销毁 */
  destroySession: () => void
  send: (data: unknown) => void
  sendReliable: (data: unknown, times?: number) => void
}

const PeerRoomContext = createContext<PeerRoomValue | null>(null)

export function PeerRoomProvider({ children }: { children?: ReactNode }) {
  const sessionRef = useRef<RoomSession | null>(null)
  const [session, setSession] = useState<RoomSession | null>(null)
  const [code, setCode] = useState('')
  const [who, setWho] = useState<NoteAbout>('her')
  const [isHost, setIsHost] = useState(false)
  const [isSpectator, setSpectator] = useState(false)
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const whoRef = useRef(who)
  whoRef.current = who

  const attachSession = useCallback(
    (next: RoomSession, meta?: { who?: NoteAbout }) => {
      sessionRef.current = next
      setSession(next)
      setCode(next.code)
      setIsHost(next.isHost)
      setSpectator(!!next.isSpectator)
      if (meta?.who) {
        whoRef.current = meta.who
        setWho(meta.who)
      }
      peerLog('房间上下文：挂上会话', {
        code: next.code,
        host: next.isHost,
        spectator: !!next.isSpectator,
        open: !!next.conn?.open,
      })
    },
    [],
  )

  const bindHandlers = useCallback((handlers: RoomHandlers) => {
    const cur = sessionRef.current
    if (!cur) return
    cur.setHandlers(handlers)
    peerLog('房间上下文：换绑回调', {
      code: cur.code,
      open: !!cur.conn?.open,
    })
  }, [])

  const destroySession = useCallback(() => {
    const cur = sessionRef.current
    sessionRef.current = null
    setSession(null)
    setPeerWho(null)
    setSpectator(false)
    setCode('')
    if (!cur) return
    try {
      cur.destroy()
    } catch {
      /* ignore */
    }
    peerLog('房间上下文：销毁会话')
  }, [])

  const send = useCallback((data: unknown) => {
    sessionRef.current?.send(data)
  }, [])

  const sendReliable = useCallback((data: unknown, times?: number) => {
    sessionRef.current?.sendReliable(data, times)
  }, [])

  // 真关闭页再释放房号。注意：手机切后台也会 pagehide，绝不能立刻 destroy，
  // 否则表现为「一切后台连接就断」；回前台由 wsRoom onFore 重连，占座靠中继顶同角色。
  useEffect(() => {
    let delayTimer = 0
    let pending: RoomSession | null = null

    const cancelDelayedRelease = () => {
      if (delayTimer) {
        window.clearTimeout(delayTimer)
        delayTimer = 0
      }
      pending = null
    }

    const releaseOnUnload = (event: PageTransitionEvent | Event) => {
      const persisted =
        'persisted' in event && (event as PageTransitionEvent).persisted
      if (persisted) return
      const cur = sessionRef.current
      if (!cur) return
      pending = cur
      if (delayTimer) window.clearTimeout(delayTimer)
      // 短切后台常在 1～2s 内回前台；超过才当真离开，避免误杀连接
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
        sessionRef.current = null
        setSession(null)
        setPeerWho(null)
        setSpectator(false)
        setCode('')
        peerLog('页面长时间在后台，销毁 Peer 释放房号', snap.code)
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
    }
  }, [])

  // 离开整个 /games 树（去墙等）时暂存，不销毁——回来还能接
  useEffect(() => {
    return () => {
      const cur = sessionRef.current
      if (!cur) return
      sessionRef.current = null
      peerLog('房间上下文：离开游戏区，暂存 Peer')
      parkPeerSession(cur)
    }
  }, [])

  const value = useMemo<PeerRoomValue>(
    () => ({
      session,
      code,
      who,
      isHost,
      isSpectator,
      peerWho,
      setWho,
      setPeerWho,
      setSpectator,
      attachSession,
      bindHandlers,
      destroySession,
      send,
      sendReliable,
    }),
    [
      session,
      code,
      who,
      isHost,
      isSpectator,
      peerWho,
      attachSession,
      bindHandlers,
      destroySession,
      send,
      sendReliable,
    ],
  )

  return (
    <PeerRoomContext.Provider value={value}>
      {children ?? <Outlet />}
    </PeerRoomContext.Provider>
  )
}

export function usePeerRoom() {
  const ctx = useContext(PeerRoomContext)
  if (!ctx) {
    throw new Error('usePeerRoom 必须在 PeerRoomProvider 内使用')
  }
  return ctx
}

export function usePeerRoomOptional() {
  return useContext(PeerRoomContext)
}

/** 页面卸载时若仍握着会话，交回上下文或暂存（由调用方决定） */
export function quietSession(session: RoomSession | null | undefined) {
  if (!session) return
  try {
    session.setHandlers(QUIET_HANDLERS)
  } catch {
    /* ignore */
  }
}
