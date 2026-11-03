import { isValidRoomCode, normalizeRoomCode } from './guessGame'
import { peerLog } from './peerLog'
import { cloudProxyBaseUrl, isCloudProxyConfigured } from './proxyConfig'
import type { RoomHandlers, RoomSession } from './peerRoom'

type RoomWireRole = 'host' | 'guest' | 'spectator'
type WireRoom = {
  type: '__room'
  role: RoomWireRole
  peers: number
  game?: string | null
  openedAt?: number | null
}
type WirePeerJoined = { type: '__peer-joined'; role: RoomWireRole }
type WirePeerLeft = { type: '__peer-left' }
type WirePing = { type: '__ping' } | { type: '__pong' }

const PING_MS = 8000
const RECONNECT_MS = 1200

function isWireControl(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) return false
  const t = (raw as { type: string }).type
  return (
    t === '__room' ||
    t === '__peer-joined' ||
    t === '__peer-left' ||
    t === '__ping' ||
    t === '__pong'
  )
}

/** 有 Cloudflare Worker 时走 WebSocket 中继（比 PeerJS/WebRTC 稳） */
export function shouldUseWsRelay(): boolean {
  if (import.meta.env.VITE_PEER_TRANSPORT === 'webrtc') return false
  return isCloudProxyConfigured()
}

function roomWsUrl(
  code: string,
  options?: { allowSpectators?: boolean },
): string {
  const base = cloudProxyBaseUrl()
  const u = new URL(base)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = `/peer/room/${code}`
  u.search = ''
  u.hash = ''
  // 仅空房开房时生效；默认不允许旁观
  if (options?.allowSpectators) u.searchParams.set('allowSpectators', '1')
  else u.searchParams.set('allowSpectators', '0')
  return u.toString()
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/**
 * 连中继并重试。已配置 WS 时不要回退 WebRTC，否则一边在中继、一边抢 PeerJS 房主会对不上。
 */
export async function connectWsRoomWithRetry(
  codeRaw: string,
  handlers: RoomHandlers,
  options?: {
    timeoutMs?: number
    tries?: number
    /** 空房开房时写入；默认 false */
    allowSpectators?: boolean
  },
): Promise<RoomSession> {
  const tries = Math.max(1, options?.tries ?? 3)
  const timeoutMs = options?.timeoutMs ?? 15000
  let lastErr: unknown
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) {
      peerLog('WS 重试进房', { code: normalizeRoomCode(codeRaw), attempt })
      await sleep(500 * attempt)
    }
    try {
      return await connectWsRoom(codeRaw, handlers, {
        timeoutMs,
        allowSpectators: options?.allowSpectators,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? '')
      if (/房间已满|不允许旁观/.test(msg)) throw err
      lastErr = err
      peerLog('WS 进房未成', { attempt, err: msg })
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('连不上房间中继，请重试')
}

/**
 * 连上 Worker 双人房中继。先到 host，后到 guest；房间已满则抛错。
 */
export async function connectWsRoom(
  codeRaw: string,
  handlers: RoomHandlers,
  options?: { timeoutMs?: number; allowSpectators?: boolean },
): Promise<RoomSession> {
  const code = normalizeRoomCode(codeRaw)
  if (!isValidRoomCode(code)) {
    throw new Error('房间号是 6 位数字')
  }
  if (!shouldUseWsRelay()) {
    throw new Error('未配置房间中继')
  }

  const timeoutMs = options?.timeoutMs ?? 20000
  const allowSpectators = !!options?.allowSpectators
  const wsUrl = roomWsUrl(code, { allowSpectators })
  peerLog('WS 进房', { code, url: wsUrl, allowSpectators })

  const bag = { current: handlers }
  let intentional = false
  let destroyed = false
  // 用对象挂 role：异步回调赋值后，外层 let 会被 CFA 收窄成初始 'host'
  const seat: { role: RoomWireRole } = { role: 'host' }
  let peerPresent = false
  // 用对象挂 socket：外层 let 会被 CFA 收窄成 null，导致 .close 报 never
  const sock: { ws: WebSocket | null } = { ws: null }
  let pingTimer = 0
  let reconnectTimer = 0
  let everOpened = false
  let sessionRef: RoomSession | null = null

  const link = {
    open: false,
    send(data: unknown) {
      if (!sock.ws || sock.ws.readyState !== WebSocket.OPEN) return
      try {
        sock.ws.send(typeof data === 'string' ? data : JSON.stringify(data))
      } catch {
        /* ignore */
      }
    },
  }

  const peerHandle = {
    get destroyed() {
      return destroyed
    },
    id: `ws-${code}`,
    disconnected: false,
  }

  function clearPing() {
    if (pingTimer) {
      window.clearInterval(pingTimer)
      pingTimer = 0
    }
  }

  function startPing() {
    clearPing()
    pingTimer = window.setInterval(() => {
      if (!sock.ws || sock.ws.readyState !== WebSocket.OPEN) return
      try {
        sock.ws.send(JSON.stringify({ type: '__ping' } satisfies WirePing))
      } catch {
        /* ignore */
      }
    }, PING_MS)
  }

  function setOpen(next: boolean) {
    const was = link.open
    link.open = next
    if (next && !was) {
      bag.current.onOpen?.()
    }
  }

  function notePeer(present: boolean) {
    const was = peerPresent
    peerPresent = present
    if (present) {
      setOpen(true)
      if (!was && everOpened) bag.current.onWake?.()
    } else if (was) {
      setOpen(false)
      bag.current.onDisconnect?.()
    }
  }

  function handleMessage(rawText: string) {
    let raw: unknown
    try {
      raw = JSON.parse(rawText)
    } catch {
      return
    }
    if (!raw || typeof raw !== 'object') return

    const msg = raw as WireRoom | WirePeerJoined | WirePeerLeft | WirePing
    if (msg.type === '__pong' || msg.type === '__ping') return

    if (msg.type === '__room') {
      seat.role = msg.role
      if (sessionRef) {
        sessionRef.isHost = seat.role === 'host'
        sessionRef.isSpectator = seat.role === 'spectator'
        sessionRef.activeGame =
          typeof msg.game === 'string' && msg.game && msg.game !== 'hub'
            ? msg.game
            : null
        sessionRef.openedAt =
          typeof msg.openedAt === 'number' && Number.isFinite(msg.openedAt)
            ? msg.openedAt
            : null
      }
      everOpened = true
      peerLog('WS 房间就绪', {
        code,
        role: seat.role,
        peers: msg.peers,
        game: msg.game || null,
      })
      if (seat.role === 'spectator') {
        // 旁观：房里已有人对战席，直接可收消息
        notePeer(true)
      } else if (msg.peers >= 2) {
        notePeer(true)
      } else {
        // 对战席独自在房：等对方进来再标 open（与原先 Peer 行为一致）
        link.open = false
      }
      return
    }

    if (msg.type === '__peer-joined') {
      peerLog('WS 对方进房', { code, role: msg.role })
      notePeer(true)
      return
    }

    if (msg.type === '__peer-left') {
      peerLog('WS 对方离开', code)
      notePeer(false)
      return
    }

    if (isWireControl(raw)) return
    bag.current.onData(raw)
  }

  function scheduleReconnect() {
    if (intentional || destroyed) return
    if (reconnectTimer) return
    peerLog('WS 计划重连', code)
    bag.current.onDisconnect?.()
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = 0
      if (intentional || destroyed) return
      void openSocket().catch((err) => {
        peerLog('WS 重连失败', err)
        scheduleReconnect()
      })
    }, RECONNECT_MS)
  }

  function wireSocket(socket: WebSocket) {
    socket.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') handleMessage(ev.data)
    })
    socket.addEventListener('close', (ev) => {
      if (sock.ws !== socket) return
      clearPing()
      link.open = false
      peerPresent = false
      peerHandle.disconnected = true
      // 24h 到期：不要自动重连，否则僵尸页会把房又开回来
      if (ev.code === 4001 || ev.reason === 'room-expired') {
        intentional = true
        peerLog('WS 房间已到期解散', code)
        bag.current.onClose?.()
        return
      }
      // 满员 / 不许旁观 / 被顶替：再连只会空转，停下来让用户重进
      if (ev.code === 4000 || ev.reason === 'room-full') {
        intentional = true
        peerLog('WS 进房被拒：房间已满', code)
        bag.current.onClose?.()
        return
      }
      if (ev.code === 4002 || ev.reason === 'no-spectators') {
        intentional = true
        peerLog('WS 进房被拒：对战席已满且不允许旁观', code)
        bag.current.onClose?.()
        return
      }
      if (ev.code === 4003 || ev.reason === 'replaced') {
        intentional = true
        peerLog('WS 被新连接顶替', code)
        bag.current.onClose?.()
        return
      }
      if (intentional || destroyed) {
        bag.current.onClose?.()
        return
      }
      peerLog('WS 断开', code)
      scheduleReconnect()
    })
    socket.addEventListener('error', () => {
      peerLog('WS 错误', code)
    })
  }

  async function openSocket(): Promise<void> {
    if (intentional || destroyed) return
    if (sock.ws) {
      try {
        sock.ws.close()
      } catch {
        /* ignore */
      }
      sock.ws = null
    }

    const url = roomWsUrl(code, { allowSpectators })
    const socket = new WebSocket(url)
    sock.ws = socket
    peerHandle.disconnected = false
    wireSocket(socket)
    startPing()

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = window.setTimeout(() => {
        finish(() => {
          try {
            socket.close()
          } catch {
            /* ignore */
          }
          reject(new Error('连房间中继超时，请重试'))
        })
      }, timeoutMs)
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        fn()
      }
      socket.addEventListener('open', () => {
        peerLog('WS 已连接', code)
        finish(() => resolve())
      })
      socket.addEventListener('error', () => {
        finish(() => reject(new Error('连不上房间中继')))
      })
      socket.addEventListener('close', (ev) => {
        if (settled) return
        if (ev.code === 4002 || ev.reason === 'no-spectators') {
          finish(() => reject(new Error('房间不允许旁观，对战席已满')))
          return
        }
        if (ev.code === 4000 || ev.reason === 'room-full') {
          finish(() => reject(new Error('房间已满')))
          return
        }
        if (ev.code === 4001 || ev.reason === 'room-expired') {
          finish(() => reject(new Error('房间已超过 24 小时，已自动解散')))
          return
        }
        finish(() => reject(new Error('连不上房间中继')))
      })
    })

    // 等 __room 握手（最多再等几秒）
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (everOpened) return
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error('房间中继已断开')
      }
      await new Promise((r) => window.setTimeout(r, 50))
    }
    throw new Error('进房握手超时')
  }

  // 首次连接：若 503 房间已满，WebSocket 构造会立刻失败
  try {
    await openSocket()
  } catch (err) {
    destroyed = true
    clearPing()
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    try {
      sock.ws?.close()
    } catch {
      /* ignore */
    }
    sock.ws = null
    throw err
  }

  // 用 HTTP 探测满员更准：WS 对 503 支持因浏览器而异，额外 HEAD/GET 无 Upgrade 时 DO 返回 426
  // 满员时 DO 在 Upgrade 前返回 503；部分浏览器仍报通用错误，文案已覆盖

  const session: RoomSession = {
    code,
    peer: peerHandle,
    conn: link,
    isHost: seat.role === 'host',
    isSpectator: seat.role === 'spectator',
    activeGame: null,
    openedAt: null,
    send(data) {
      link.send(data)
    },
    sendReliable(data, times = 3) {
      link.send(data)
      for (let i = 1; i < times; i++) {
        window.setTimeout(() => link.send(data), 250 * i)
      }
    },
    setHandlers(next) {
      bag.current = next
    },
    destroy() {
      peerLog('销毁 WS 会话', code)
      intentional = true
      destroyed = true
      clearPing()
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      reconnectTimer = 0
      document.removeEventListener('visibilitychange', onFore)
      window.removeEventListener('online', onFore)
      try {
        sock.ws?.close()
      } catch {
        /* ignore */
      }
      sock.ws = null
      link.open = false
    },
  }
  sessionRef = session

  function onFore() {
    if (document.visibilityState === 'hidden') return
    if (intentional || destroyed) return
    if (sock.ws && sock.ws.readyState === WebSocket.OPEN) {
      bag.current.onWake?.()
      return
    }
    scheduleReconnect()
  }
  document.addEventListener('visibilitychange', onFore)
  window.addEventListener('online', onFore)

  return session
}
