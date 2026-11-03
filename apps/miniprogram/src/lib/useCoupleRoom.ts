import { useEffect, useRef, useState } from 'react'
import { CoupleRoom, type RoomHandlers } from './room'

/** 页面级房间钩子：进页连接，离页销毁 */
export function useCoupleRoom(handlers: RoomHandlers) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const [ready, setReady] = useState(false)
  const [peer, setPeer] = useState(false)
  const roomRef = useRef<CoupleRoom | null>(null)

  useEffect(() => {
    let dead = false
    const room = new CoupleRoom({
      onData: (d) => handlersRef.current.onData(d),
      onOpen: () => {
        if (dead) return
        setReady(true)
        handlersRef.current.onOpen?.()
      },
      onPeer: (p) => {
        if (dead) return
        setPeer(p)
        handlersRef.current.onPeer?.(p)
      },
      onError: (m) => handlersRef.current.onError?.(m),
    })
    roomRef.current = room
    void room.connect().catch((err) => {
      handlersRef.current.onError?.(err instanceof Error ? err.message : '进房失败')
    })
    return () => {
      dead = true
      room.destroy()
      roomRef.current = null
    }
  }, [])

  return {
    ready,
    peer,
    isHost: roomRef.current?.isHost ?? false,
    send: (data: unknown) => roomRef.current?.send(data),
    sendReliable: (data: unknown, times?: number) =>
      roomRef.current?.sendReliable(data, times),
  }
}
