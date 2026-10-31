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
  peerWho: NoteAbout | null
  setWho: (who: NoteAbout) => void
  setPeerWho: (who: NoteAbout | null) => void
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
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const whoRef = useRef(who)
  whoRef.current = who

  const attachSession = useCallback(
    (next: RoomSession, meta?: { who?: NoteAbout }) => {
      sessionRef.current = next
      setSession(next)
      setCode(next.code)
      setIsHost(next.isHost)
      if (meta?.who) {
        whoRef.current = meta.who
        setWho(meta.who)
      }
      peerLog('房间上下文：挂上会话', {
        code: next.code,
        host: next.isHost,
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
      peerWho,
      setWho,
      setPeerWho,
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
