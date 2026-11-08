import { cloudProxyBaseUrl, isCloudProxyConfigured } from './proxyConfig'

export type OnlineRoom = {
  code: string
  peers: number
  at: number
  /** 房间当前游戏（中继进度，可能为空） */
  game?: string
  /** 是否允许旁观；缺省按 false */
  allowSpectators?: boolean
  /** 房主已加机器人：列表展示人机对战，不可加入 */
  solo?: boolean
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
    if (row.solo) next.solo = true
    out.push(next)
  }
  return out
}

/** 人机房登记到在线目录（无 WebRTC，靠 HTTP 心跳保活） */
export async function upsertRoomPresence(opts: {
  code: string
  peers: number
  solo?: boolean
  game?: string | null
  allowSpectators?: boolean
  keepalive?: boolean
}): Promise<void> {
  const code = opts.code.replace(/\D/g, '').slice(0, 6)
  if (!/^\d{6}$/.test(code) || !isCloudProxyConfigured()) return
  const body = JSON.stringify({
    code,
    peers: Math.max(0, Math.min(8, opts.peers)),
    solo: !!opts.solo,
    game: opts.game && opts.game !== 'hub' ? opts.game : null,
    allowSpectators: !!opts.allowSpectators,
  })
  try {
    await fetch(`${cloudProxyBaseUrl()}/peer/rooms/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      keepalive: !!opts.keepalive,
    })
  } catch {
    /* ignore */
  }
}

type SoloPresenceState = {
  code: string
  getGame: () => string | null | undefined
  allowSpectators: boolean
  beatTimer: number
  startTimer: number
}

/** 跨大厅 ↔ 对局页保活；离开房间时 clearSoloRoomPresence */
let soloPresence: SoloPresenceState | null = null

function pushSoloPresence(peers: number, keepalive = false) {
  const cur = soloPresence
  if (!cur) return
  if (peers <= 0) {
    void upsertRoomPresence({
      code: cur.code,
      peers: 0,
      solo: false,
      game: null,
      keepalive,
    })
    return
  }
  const game = cur.getGame() ?? null
  void upsertRoomPresence({
    code: cur.code,
    peers: 1,
    solo: true,
    game,
    allowSpectators: cur.allowSpectators,
    keepalive,
  })
}

function onSoloVisibilityHide() {
  if (document.visibilityState !== 'hidden') return
  pushSoloPresence(1, true)
}

/**
 * 人机对战：拆掉中继后仍挂在大厅列表。
 * 模块单例，切游戏页不中断；先等 leave 落盘再登记。
 */
export function startSoloRoomPresence(
  code: string,
  opts?: {
    getGame?: () => string | null | undefined
    allowSpectators?: boolean
  },
): void {
  const roomCode = code.replace(/\D/g, '').slice(0, 6)
  if (!/^\d{6}$/.test(roomCode)) return

  const same =
    soloPresence &&
    soloPresence.code === roomCode &&
    !soloPresence.startTimer
  if (same) {
    soloPresence.getGame = opts?.getGame ?? soloPresence.getGame
    soloPresence.allowSpectators =
      opts?.allowSpectators ?? soloPresence.allowSpectators
    pushSoloPresence(1)
    return
  }

  clearSoloRoomPresence({ removeFromDirectory: false })

  const state: SoloPresenceState = {
    code: roomCode,
    getGame: opts?.getGame ?? (() => null),
    allowSpectators: !!opts?.allowSpectators,
    beatTimer: 0,
    startTimer: 0,
  }
  soloPresence = state
  document.addEventListener('visibilitychange', onSoloVisibilityHide)

  // 等 destroySession 的 __leave 先把目录清掉，再登记人机，避免被 leave 盖掉
  state.startTimer = window.setTimeout(() => {
    if (soloPresence !== state) return
    state.startTimer = 0
    pushSoloPresence(1)
    state.beatTimer = window.setInterval(() => pushSoloPresence(1), 20000)
  }, 600)
}

/** 更新人机目录里的当前游戏（进局 / 回大厅） */
export function setSoloRoomPresenceGame(game: string | null | undefined) {
  if (!soloPresence) return
  const next = game && game !== 'hub' ? String(game) : null
  soloPresence.getGame = () => next
  pushSoloPresence(1)
}

/** 离开人机房：停心跳并从目录摘掉 */
export function clearSoloRoomPresence(opts?: {
  removeFromDirectory?: boolean
}) {
  const cur = soloPresence
  if (!cur) return
  soloPresence = null
  if (cur.startTimer) window.clearTimeout(cur.startTimer)
  if (cur.beatTimer) window.clearInterval(cur.beatTimer)
  document.removeEventListener('visibilitychange', onSoloVisibilityHide)
  if (opts?.removeFromDirectory === false) return
  void upsertRoomPresence({
    code: cur.code,
    peers: 0,
    solo: false,
    game: null,
    keepalive: true,
  })
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
