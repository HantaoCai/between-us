import { Peer, type DataConnection } from 'peerjs'
import { isValidRoomCode, normalizeRoomCode, randomRoomCode, ROOM_PREFIX } from './guessGame'

export type RoomHandlers = {
  onData: (data: unknown) => void
  onOpen?: () => void
  /** 连接暂时断开，正在等重连 / 自行重连 */
  onDisconnect?: () => void
  /** 放弃重连后的最终断开 */
  onClose?: () => void
  onError?: (message: string) => void
}

export type RoomSession = {
  code: string
  peer: Peer
  conn: DataConnection | null
  isHost: boolean
  send: (data: unknown) => void
  /** 连接就绪后连发几次，避免对方还没挂上监听漏掉第一包 */
  sendReliable: (data: unknown, times?: number) => void
  destroy: () => void
}

const KEEP_MS = 2500
const REJOIN_WAIT_MS = 45000
const JOIN_RETRY_MAX = 6

type WirePing = { type: '__ping' } | { type: '__pong' }

function isWirePing(raw: unknown): raw is WirePing {
  return (
    !!raw &&
    typeof raw === 'object' &&
    'type' in raw &&
    ((raw as WirePing).type === '__ping' || (raw as WirePing).type === '__pong')
  )
}

function waitOpen(peer: Peer) {
  return new Promise<void>((resolve, reject) => {
    peer.on('open', () => resolve())
    peer.on('error', (err) => reject(err))
  })
}

function makeSend(getConn: () => DataConnection | null) {
  const send = (data: unknown) => {
    const conn = getConn()
    if (conn?.open) conn.send(data)
  }
  const sendReliable = (data: unknown, times = 3) => {
    send(data)
    for (let i = 1; i < times; i++) {
      window.setTimeout(() => send(data), 250 * i)
    }
  }
  return { send, sendReliable }
}

function startKeepalive(getConn: () => DataConnection | null, alive: () => boolean) {
  const id = window.setInterval(() => {
    if (!alive()) return
    const conn = getConn()
    if (conn?.open) {
      try {
        conn.send({ type: '__ping' } satisfies WirePing)
      } catch {
        /* ignore */
      }
    }
  }, KEEP_MS)
  return () => window.clearInterval(id)
}

function wireConn(
  conn: DataConnection,
  handlers: RoomHandlers,
  opts: { intentional: () => boolean; onUnexpectedClose: () => void },
) {
  let opened = false
  const markOpen = () => {
    if (opened) return
    opened = true
    handlers.onOpen?.()
  }

  conn.on('data', (raw) => {
    if (isWirePing(raw)) {
      if (raw.type === '__ping' && conn.open) {
        try {
          conn.send({ type: '__pong' } satisfies WirePing)
        } catch {
          /* ignore */
        }
      }
      return
    }
    handlers.onData(raw)
  })
  conn.on('open', markOpen)
  conn.on('close', () => {
    if (opts.intentional()) return
    opts.onUnexpectedClose()
  })
  conn.on('error', () => {
    if (opts.intentional()) return
    handlers.onError?.('连接出错')
  })

  if (conn.open) markOpen()
}

export async function createPeerRoom(
  handlers: RoomHandlers,
  options?: { code?: string },
): Promise<RoomSession> {
  const code =
    options?.code && isValidRoomCode(normalizeRoomCode(options.code))
      ? normalizeRoomCode(options.code)
      : randomRoomCode()
  const peer = new Peer(`${ROOM_PREFIX}${code}`)
  await waitOpen(peer)

  let conn: DataConnection | null = null
  let intentional = false
  let stopKeep: (() => void) | null = null
  let rejoinTimer = 0
  const { send, sendReliable } = makeSend(() => conn)

  const clearRejoinTimer = () => {
    if (rejoinTimer) {
      window.clearTimeout(rejoinTimer)
      rejoinTimer = 0
    }
  }

  const session: RoomSession = {
    code,
    peer,
    conn: null,
    isHost: true,
    send,
    sendReliable,
    destroy() {
      intentional = true
      clearRejoinTimer()
      stopKeep?.()
      stopKeep = null
      try {
        conn?.close()
      } catch {
        /* ignore */
      }
      peer.destroy()
    },
  }

  peer.on('connection', (incoming) => {
    if (intentional) {
      incoming.close()
      return
    }
    // 已有活连接时拒掉后来者；断开后允许重新加入
    if (conn?.open) {
      incoming.close()
      return
    }
    try {
      conn?.close()
    } catch {
      /* ignore */
    }
    clearRejoinTimer()
    stopKeep?.()
    conn = incoming
    session.conn = incoming
    stopKeep = startKeepalive(
      () => conn,
      () => !intentional,
    )
    wireConn(incoming, handlers, {
      intentional: () => intentional,
      onUnexpectedClose: () => {
        handlers.onDisconnect?.()
        clearRejoinTimer()
        rejoinTimer = window.setTimeout(() => {
          if (intentional) return
          if (conn?.open) return
          handlers.onClose?.()
        }, REJOIN_WAIT_MS)
      },
    })
  })

  return session
}

export async function joinPeerRoom(
  codeRaw: string,
  handlers: RoomHandlers,
): Promise<RoomSession> {
  const code = normalizeRoomCode(codeRaw)
  if (!isValidRoomCode(code)) {
    throw new Error('房间号是 6 位数字')
  }

  const peer = new Peer(
    `${ROOM_PREFIX}${randomRoomCode()}-joiner-${Date.now().toString(36)}`,
  )
  await waitOpen(peer)

  let conn: DataConnection | null = null
  let intentional = false
  let established = false
  let retry = 0
  let retryTimer = 0
  const hostId = `${ROOM_PREFIX}${code}`
  const { send, sendReliable } = makeSend(() => conn)
  // 用对象包一层，避免 await 后 CFA 把 stopKeep 收窄成 null
  const life = { stopKeep: null as (() => void) | null }

  const session: RoomSession = {
    code,
    peer,
    conn: null,
    isHost: false,
    send,
    sendReliable,
    destroy() {
      intentional = true
      if (retryTimer) window.clearTimeout(retryTimer)
      life.stopKeep?.()
      life.stopKeep = null
      try {
        conn?.close()
      } catch {
        /* ignore */
      }
      peer.destroy()
    },
  }

  function attach(next: DataConnection) {
    life.stopKeep?.()
    conn = next
    session.conn = next
    life.stopKeep = startKeepalive(
      () => conn,
      () => !intentional,
    )
    wireConn(next, handlers, {
      intentional: () => intentional,
      onUnexpectedClose: () => {
        if (intentional || !established) return
        handlers.onDisconnect?.()
        scheduleReconnect()
      },
    })
  }

  function scheduleReconnect() {
    if (intentional || !established) return
    if (retry >= JOIN_RETRY_MAX) {
      handlers.onClose?.()
      return
    }
    retry += 1
    const delay = Math.min(8000, 700 * retry)
    if (retryTimer) window.clearTimeout(retryTimer)
    retryTimer = window.setTimeout(() => {
      if (intentional) return
      try {
        const next = peer.connect(hostId, { reliable: true })
        const failTimer = window.setTimeout(() => {
          try {
            next.close()
          } catch {
            /* ignore */
          }
          scheduleReconnect()
        }, 10000)
        next.on('open', () => {
          window.clearTimeout(failTimer)
          retry = 0
          attach(next)
        })
        next.on('error', () => {
          window.clearTimeout(failTimer)
          scheduleReconnect()
        })
      } catch {
        scheduleReconnect()
      }
    }, delay)
  }

  const first = peer.connect(hostId, { reliable: true })
  attach(first)

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error('连不上，确认房间号或让对方先开房')),
        15000,
      )
      const ok = () => {
        window.clearTimeout(timer)
        resolve()
      }
      first.on('open', ok)
      first.on('error', (err) => {
        window.clearTimeout(timer)
        reject(err)
      })
      if (first.open) ok()
    })
  } catch (err) {
    intentional = true
    life.stopKeep?.()
    life.stopKeep = null
    peer.destroy()
    throw err
  }

  established = true
  return session
}
