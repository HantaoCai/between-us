import { isValidRoomCode, normalizeRoomCode } from './guessGame'
import { peerLog } from './peerLog'
import { cloudProxyBaseUrl, isCloudProxyConfigured } from './proxyConfig'
import type { RoomHandlers, RoomSession } from './peerRoom'

type WireRoom = { type: '__room'; role: 'host' | 'guest'; peers: number }
type WirePeerJoined = { type: '__peer-joined'; role: 'host' | 'guest' }
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

function roomWsUrl(code: string): string {
  const base = cloudProxyBaseUrl()
  const u = new URL(base)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = `/peer/room/${code}`
  u.search = ''
  u.hash = ''
  return u.toString()
}

/**
 * 连上 Worker 双人房中继。先到 host，后到 guest；房间已满则抛错。
 */
export async function connectWsRoom(
  codeRaw: string,
  handlers: RoomHandlers,
  options?: { timeoutMs?: number },
): Promise<RoomSession> {
  const code = normalizeRoomCode(codeRaw)
  if (!isValidRoomCode(code)) {
    throw new Error('房间号是 6 位数字')
  }
  if (!shouldUseWsRelay()) {
    throw new Error('未配置房间中继')
  }

  const timeoutMs = options?.timeoutMs ?? 20000
  peerLog('WS 进房', { code, url: roomWsUrl(code) })

  const bag = { current: handlers }
  let intentional = false
  let destroyed = false
  let role: 'host' | 'guest' = 'host'
  let peerPresent = false
  let ws: WebSocket | null = null
  let pingTimer = 0
  let reconnectTimer = 0
  let everOpened = false
  let sessionRef: RoomSession | null = null

  const link = {
    open: false,
    send(data: unknown) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(typeof data === 'string' ? data : JSON.stringify(data))
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
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify({ type: '__ping' } satisfies WirePing))
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
      role = msg.role
      if (sessionRef) sessionRef.isHost = role === 'host'
      everOpened = true
      peerLog('WS 房间就绪', { code, role, peers: msg.peers })
      if (msg.peers >= 2) notePeer(true)
      else {
        // 独自在房：等对方进来再标 open（与原先 Peer 行为一致）
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
    socket.addEventListener('close', () => {
      if (ws !== socket) return
      clearPing()
      link.open = false
      peerPresent = false
      peerHandle.disconnected = true
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
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }

    const url = roomWsUrl(code)
    const socket = new WebSocket(url)
    ws = socket
    peerHandle.disconnected = false
    wireSocket(socket)
    startPing()

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = window.setTimeout(() => {
        finish(() => reject(new Error('连房间中继超时，请重试')))
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
        if (ev.code === 4000 || ev.reason === 'room-full') {
          finish(() => reject(new Error('房间已满，最多两人')))
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
      ws?.close()
    } catch {
      /* ignore */
    }
    throw err
  }

  // 用 HTTP 探测满员更准：WS 对 503 支持因浏览器而异，额外 HEAD/GET 无 Upgrade 时 DO 返回 426
  // 满员时 DO 在 Upgrade 前返回 503；部分浏览器仍报通用错误，文案已覆盖

  const session: RoomSession = {
    code,
    peer: peerHandle,
    conn: link,
    isHost: role === 'host',
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
        ws?.close()
      } catch {
        /* ignore */
      }
      ws = null
      link.open = false
    },
  }
  sessionRef = session

  function onFore() {
    if (document.visibilityState === 'hidden') return
    if (intentional || destroyed) return
    if (ws && ws.readyState === WebSocket.OPEN) {
      bag.current.onWake?.()
      return
    }
    scheduleReconnect()
  }
  document.addEventListener('visibilitychange', onFore)
  window.addEventListener('online', onFore)

  return session
}
