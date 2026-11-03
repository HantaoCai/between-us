import { cloudProxyBaseUrl, isCloudProxyConfigured } from './proxyConfig'

export type OnlineRoom = {
  code: string
  peers: number
  at: number
  /** 房间当前游戏（中继进度，可能为空） */
  game?: string
  /** 是否允许旁观；缺省按 false */
  allowSpectators?: boolean
}

function normalizeRooms(raw: unknown): OnlineRoom[] {
  if (!Array.isArray(raw)) return []
  const out: OnlineRoom[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const row = r as OnlineRoom
    if (typeof row.code !== 'string' || !/^\d{6}$/.test(row.code)) continue
    if (typeof row.peers !== 'number' || row.peers <= 0) continue
    const next: OnlineRoom = {
      code: row.code,
      peers: row.peers,
      at: typeof row.at === 'number' ? row.at : 0,
      allowSpectators: Boolean(row.allowSpectators),
    }
    if (typeof row.game === 'string' && row.game && row.game !== 'hub') {
      next.game = row.game
    }
    out.push(next)
  }
  return out
}

/** 拉当前仍有端连着的房间（HTTP 快照；大厅优先走 WS 推送） */
export async function fetchOnlineRooms(): Promise<OnlineRoom[]> {
  if (!isCloudProxyConfigured()) return []
  try {
    const res = await fetch(`${cloudProxyBaseUrl()}/peer/rooms`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { rooms?: OnlineRoom[] }
    return normalizeRooms(data.rooms)
  } catch {
    return []
  }
}

function roomsWatchUrl(): string {
  const base = cloudProxyBaseUrl()
  const u = new URL(base)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/peer/rooms/watch'
  u.search = ''
  u.hash = ''
  return u.toString()
}

/**
 * 订阅在线房列表：进出房由 Worker 推送全量列表，无需轮询。
 * 返回取消订阅函数。
 */
export function subscribeOnlineRooms(
  onRooms: (rooms: OnlineRoom[]) => void,
): () => void {
  if (!isCloudProxyConfigured() || typeof WebSocket === 'undefined') {
    onRooms([])
    return () => {}
  }

  let closed = false
  let ws: WebSocket | null = null
  let pingTimer = 0
  let reconnectTimer = 0
  let attempt = 0

  const clearTimers = () => {
    if (pingTimer) {
      window.clearInterval(pingTimer)
      pingTimer = 0
    }
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = 0
    }
  }

  const handleMessage = (rawText: string) => {
    let raw: unknown
    try {
      raw = JSON.parse(rawText)
    } catch {
      return
    }
    if (!raw || typeof raw !== 'object') return
    const msg = raw as { type?: string; rooms?: unknown }
    if (msg.type === '__pong' || msg.type === '__ping') return
    if (msg.type === 'rooms') onRooms(normalizeRooms(msg.rooms))
  }

  const connect = () => {
    if (closed) return
    clearTimers()
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
    ws = null

    const socket = new WebSocket(roomsWatchUrl())
    ws = socket

    socket.addEventListener('open', () => {
      attempt = 0
      pingTimer = window.setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return
        try {
          socket.send(JSON.stringify({ type: '__ping' }))
        } catch {
          /* ignore */
        }
      }, 20000)
    })

    socket.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') handleMessage(ev.data)
    })

    socket.addEventListener('close', () => {
      clearTimers()
      if (closed) return
      const delay = Math.min(8000, 600 * 2 ** Math.min(attempt, 4))
      attempt += 1
      reconnectTimer = window.setTimeout(connect, delay)
    })

    socket.addEventListener('error', () => {
      try {
        socket.close()
      } catch {
        /* ignore */
      }
    })
  }

  connect()

  return () => {
    closed = true
    clearTimers()
    try {
      ws?.close()
    } catch {
      /* ignore */
    }
    ws = null
  }
}
