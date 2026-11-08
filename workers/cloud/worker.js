/**
 * Between Us · Cloudflare Worker
 *
 * 路径：
 *   GET  /                       → 前端静态站（Workers Assets / dist）
 *   GET  /health                 → 健康检查
 *   POST /jev                    → 代理 TypeSafe Jev
 *   GET  /edit/status            → 线上是否可钉（需绑 R2）
 *   GET  /edit/notes             → 读墙数据（R2 data/notes.json）
 *   PUT  /edit/notes             → 写墙数据（需 Token）
 *   POST /edit/upload            → 上传照片到 R2（需 Token；自动加时间戳文件名）
 *   POST /edit/object            → 按指定 key 写入 R2（迁移旧图用，需 Token）
 *   DELETE /edit/photo           → 删 R2 照片（需 Token）
 *   GET  /media/photos/...       → 公开读图
 *   POST /stats/view             → 拾光页浏览上报（公开；R2 data/stats.json）
 *   GET  /stats                  → 读 PV / UV 聚合（公开，不返回 visitorId）
 *   GET  /peer/room/:code        → WebSocket 双人房中继（Durable Object；替代 PeerJS）
 *   GET  /peer/rooms             → 当前有人连着的房间列表（HTTP 快照）
 *   GET  /peer/rooms/watch       → WebSocket：进房/离房时推送房间列表
 *   GET  /peer/logs              → 最近进出房事件（排查卡死用）
 *
 * 房间寿命：自首次有人起 24 小时后强制解散；目录同步清掉过期项。
 *
 * Secrets：
 *   TYPESAFE_API_KEY   Jev 用
 *   PROXY_TOKEN        可选；写接口与 /jev 校验 X-Between-Us-Token
 *
 * Variables：
 *   TYPESAFE_MODEL / ALLOWED_ORIGINS / PUBLIC_ORIGIN
 *
 * Bindings：
 *   ASSETS    → 静态前端（wrangler [assets]，目录 ../../dist）
 *   MEDIA     → R2 bucket（钉照片必绑）
 *   ROOMS     → Durable Object RoomBroker（双人房中继）
 *   ROOM_DIR  → Durable Object RoomDirectory（在线房登记）
 */

const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone'
const NOTES_KEY = 'data/notes.json'
const PHOTOS_KEY = 'data/photos.json'
const STATS_KEY = 'data/stats.json'
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const MAX_VISITOR_IDS = 10000
const VISITOR_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const DEFAULT_ORIGINS = [
  'http://127.0.0.1:43217',
  'http://localhost:43217',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'https://hantaocai.github.io',
  'https://hantao-jiajia.cn',
  'https://www.hantao-jiajia.cn',
]

/** 对外媒体域名：优先自定义域，避免钉照片写成 workers.dev（国内常打不开） */
const DEFAULT_PUBLIC_ORIGIN = 'https://hantao-jiajia.cn'

const PEER_LOG_KEY = 'log:recent'
const PEER_LOG_MAX = 100
/** 房间最长存活：首次有人起算；目录里超过此时长的残留也清掉 */
const ROOM_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 在线房间目录：只登记仍有 WebSocket 挂着的房（电脑开着、页没关）。
 * 同时保留最近进出房日志，便于排查「进出几次就卡死」。
 */
export class RoomDirectory {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
  }

  async appendLog(entry) {
    try {
      const prev = (await this.ctx.storage.get(PEER_LOG_KEY)) || []
      const list = Array.isArray(prev) ? prev : []
      list.push({ ...entry, at: Date.now() })
      while (list.length > PEER_LOG_MAX) list.shift()
      await this.ctx.storage.put(PEER_LOG_KEY, list)
    } catch {
      /* ignore */
    }
  }

  async listRooms() {
    const listed = await this.ctx.storage.list({ prefix: 'room:' })
    const rooms = []
    const staleKeys = []
    const now = Date.now()
    for (const [key, value] of listed) {
      const code = key.slice('room:'.length)
      const peers = value && typeof value === 'object' ? Number(value.peers) || 0 : 0
      const at = value && typeof value === 'object' ? Number(value.at) || 0 : 0
      const game =
        value && typeof value === 'object' && value.game
          ? String(value.game)
          : ''
      const allowSpectators =
        value && typeof value === 'object'
          ? Boolean(value.allowSpectators)
          : false
      const solo =
        value && typeof value === 'object' ? Boolean(value.solo) : false
      if (!/^\d{6}$/.test(code) || peers <= 0) {
        staleKeys.push(key)
        continue
      }
      // 超过 TTL 的目录残留（离房事件丢了也会堆着）直接删掉
      if (at > 0 && now - at >= ROOM_TTL_MS) {
        staleKeys.push(key)
        continue
      }
      // 人机靠 HTTP 心跳；超过 90s 无心跳视为已离开
      if (solo && at > 0 && now - at >= 90_000) {
        staleKeys.push(key)
        continue
      }
      const row = { code, peers, at, allowSpectators }
      if (game) row.game = game
      if (solo) row.solo = true
      rooms.push(row)
    }
    if (staleKeys.length) {
      try {
        await this.ctx.storage.delete(staleKeys)
      } catch {
        /* ignore */
      }
    }
    rooms.sort((a, b) => b.at - a.at)
    return rooms
  }

  async broadcastRooms() {
    const rooms = await this.listRooms()
    const payload = JSON.stringify({ type: 'rooms', rooms })
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload)
      } catch {
        /* ignore */
      }
    }
    return rooms
  }

  async fetch(request) {
    const url = new URL(request.url)

    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.ctx.acceptWebSocket(server)
      try {
        const rooms = await this.listRooms()
        server.send(JSON.stringify({ type: 'rooms', rooms }))
      } catch {
        /* ignore */
      }
      return new Response(null, { status: 101, webSocket: client })
    }

    if (request.method === 'POST' && url.pathname === '/upsert') {
      let body
      try {
        body = await request.json()
      } catch {
        return new Response('bad json', { status: 400 })
      }
      const code = String(body?.code || '').replace(/\D/g, '').slice(0, 6)
      const peers = Math.max(0, Math.min(8, Number(body?.peers) || 0))
      const event = String(body?.event || 'presence')
      if (!/^\d{6}$/.test(code)) {
        return new Response('bad code', { status: 400 })
      }
      const key = `room:${code}`
      const detail =
        body?.detail && typeof body.detail === 'object' ? body.detail : null
      const gameRaw = detail && detail.game != null ? String(detail.game) : ''
      const game =
        gameRaw && gameRaw !== 'hub' ? gameRaw.slice(0, 32) : ''
      if (peers <= 0) {
        await this.ctx.storage.delete(key)
      } else {
        const prev = await this.ctx.storage.get(key)
        const prevGame =
          prev && typeof prev === 'object' && prev.game
            ? String(prev.game)
            : ''
        const prevAllow =
          prev && typeof prev === 'object'
            ? Boolean(prev.allowSpectators)
            : false
        const prevSolo =
          prev && typeof prev === 'object' ? Boolean(prev.solo) : false
        // detail 显式带 game（含清空）时覆盖；否则沿用目录里上一份
        const nextGame =
          detail && 'game' in detail ? game : prevGame
        const nextAllow =
          detail && 'allowSpectators' in detail
            ? Boolean(detail.allowSpectators)
            : prevAllow
        // 真人进出/进度默认清掉人机标记；显式带 solo 时按传入
        const nextSolo =
          detail && 'solo' in detail
            ? Boolean(detail.solo)
            : event === 'join' || event === 'leave' || event === 'progress'
              ? false
              : prevSolo
        const row = {
          peers,
          at: Date.now(),
          allowSpectators: nextAllow,
        }
        if (nextGame) row.game = nextGame
        if (nextSolo) row.solo = true
        await this.ctx.storage.put(key, row)
      }
      await this.appendLog({ event, code, peers, detail })
      console.log(JSON.stringify({ tag: 'peer-dir', event, code, peers, game: game || null }))
      // 有人进出：推给大厅订阅者，免前端轮询
      await this.broadcastRooms()
      return new Response('ok')
    }

    if (request.method === 'POST' && url.pathname === '/log') {
      let body
      try {
        body = await request.json()
      } catch {
        return new Response('bad json', { status: 400 })
      }
      await this.appendLog({
        event: String(body?.event || 'note'),
        code: body?.code ? String(body.code) : null,
        peers: body?.peers ?? null,
        detail: body?.detail || null,
      })
      console.log(JSON.stringify({ tag: 'peer-dir', ...body }))
      return new Response('ok')
    }

    if (request.method === 'GET' && url.pathname === '/list') {
      return Response.json({ rooms: await this.listRooms() })
    }

    if (request.method === 'GET' && url.pathname === '/logs') {
      const list = (await this.ctx.storage.get(PEER_LOG_KEY)) || []
      return Response.json({ logs: Array.isArray(list) ? list : [] })
    }

    return new Response('not found', { status: 404 })
  }

  async webSocketMessage(ws, message) {
    let text =
      typeof message === 'string'
        ? message
        : new TextDecoder().decode(message)
    try {
      const msg = JSON.parse(text)
      if (msg && msg.type === '__ping') {
        ws.send(JSON.stringify({ type: '__pong' }))
        return
      }
      if (msg && msg.type === 'sync') {
        const rooms = await this.listRooms()
        ws.send(JSON.stringify({ type: 'rooms', rooms }))
      }
    } catch {
      /* ignore */
    }
  }

  async webSocketClose() {
    /* 订阅断开即可，无需广播 */
  }

  async webSocketError(ws) {
    try {
      ws.close(1011, 'error')
    } catch {
      /* ignore */
    }
  }
}

function roomDirStub(env) {
  if (!env.ROOM_DIR) return null
  return env.ROOM_DIR.get(env.ROOM_DIR.idFromName('global'))
}

async function publishRoomPresence(env, code, peers, event = 'presence', detail = null) {
  if (!env.ROOM_DIR || !/^\d{6}$/.test(code)) return
  try {
    const stub = roomDirStub(env)
    if (!stub) return
    await stub.fetch(
      new Request('https://room-dir/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, peers, event, detail }),
      }),
    )
  } catch (err) {
    console.log(
      JSON.stringify({
        tag: 'peer-dir',
        event: 'upsert-fail',
        code,
        err: String(err?.message || err),
      }),
    )
  }
}

async function peerLog(env, entry) {
  try {
    const stub = roomDirStub(env)
    if (!stub) return
    await stub.fetch(
      new Request('https://room-dir/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }),
    )
  } catch {
    /* ignore */
  }
}

function roomCodeFromRequest(request) {
  try {
    const path = new URL(request.url).pathname
    const m = path.match(/\/peer\/room\/(\d{6})/)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

/**
 * 房间 WebSocket 中继：前两席 host/guest 对战，第三人起 spectator 旁观；消息互相转发。
 * 不走 WebRTC，国内跨运营商更稳。
 * 寿命：人走光立刻清；对战席（host/guest）入场才刷新 24h，旁观不续命。
 * allowSpectators：开房时设定（默认 false）；为 false 时第三人起拒绝。
 * activeGame：当前在玩哪款（仅本轮有人期间），进房 __room 带回、目录可展示。
 */
const ROOM_MAX_PEERS = 8
const ROOM_OPENED_KEY = 'openedAt'
const ROOM_CODE_KEY = 'code'
const ROOM_GAME_KEY = 'activeGame'
const ROOM_ALLOW_SPEC_KEY = 'allowSpectators'

function socketRole(ws) {
  try {
    const att = ws.deserializeAttachment()
    if (att && typeof att === 'object' && att.role) return String(att.role)
  } catch {
    /* ignore */
  }
  return ''
}

function socketAttachment(ws) {
  try {
    const att = ws.deserializeAttachment()
    return att && typeof att === 'object' ? att : null
  } catch {
    return null
  }
}

/** 只数还开着的连接；离开中的 CLOSING/CLOSED 不占人数（否则房主离开目录不减） */
function countOpenPeers(sockets, excluding) {
  let n = 0
  for (const s of sockets) {
    if (excluding && s === excluding) continue
    try {
      const rs = s.readyState
      if (rs === 2 /* CLOSING */ || rs === 3 /* CLOSED */) continue
    } catch {
      /* ignore */
    }
    try {
      const att = socketAttachment(s)
      if (att && att.left) continue
    } catch {
      /* ignore */
    }
    n += 1
  }
  return n
}

function pickRoomRole(live) {
  let hasHost = false
  let hasGuest = false
  for (const peer of live) {
    const role = socketRole(peer)
    if (role === 'host') hasHost = true
    else if (role === 'guest') hasGuest = true
  }
  if (!hasHost) return 'host'
  if (!hasGuest) return 'guest'
  return 'spectator'
}

/** 意外断线后延迟通知对端：切后台常会断 WS，宽限内重连则对方无感 */
const PEER_LEFT_NOTIFY_GRACE_MS = 15000

export class RoomBroker {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
    /** 递增可取消尚未发出的 __peer-left（重连/有人进房） */
    this.leaveNotifyEpoch = 0
  }

  /** 目录立刻扣人；对端 UI 延迟收到离开，避免短暂切后台锁死对方操作 */
  scheduleSoftPeerLeftNotify() {
    const epoch = ++this.leaveNotifyEpoch
    this.ctx.waitUntil(
      (async () => {
        await new Promise((r) => setTimeout(r, PEER_LEFT_NOTIFY_GRACE_MS))
        if (epoch !== this.leaveNotifyEpoch) return
        for (const peer of this.ctx.getWebSockets()) {
          try {
            const rs = peer.readyState
            if (rs === 2 || rs === 3) continue
          } catch {
            /* ignore */
          }
          const att = socketAttachment(peer)
          if (att && att.left) continue
          try {
            peer.send(JSON.stringify({ type: '__peer-left' }))
          } catch {
            /* ignore */
          }
        }
      })(),
    )
  }

  cancelSoftPeerLeftNotify() {
    this.leaveNotifyEpoch += 1
  }

  async clearLifetime() {
    await this.ctx.storage.delete(ROOM_OPENED_KEY)
    await this.ctx.storage.delete(ROOM_CODE_KEY)
    await this.ctx.storage.delete(ROOM_GAME_KEY)
    await this.ctx.storage.delete(ROOM_ALLOW_SPEC_KEY)
    try {
      await this.ctx.storage.deleteAlarm()
    } catch {
      /* ignore */
    }
  }

  async readAllowSpectators() {
    try {
      const v = await this.ctx.storage.get(ROOM_ALLOW_SPEC_KEY)
      return v === 1 || v === true || v === '1'
    } catch {
      return false
    }
  }

  async readActiveGame() {
    try {
      const g = String((await this.ctx.storage.get(ROOM_GAME_KEY)) || '')
      return g && g !== 'hub' ? g : ''
    } catch {
      return ''
    }
  }

  /** 写入当前游戏；hub / 空则清掉。并同步到在线目录。 */
  async writeActiveGame(code, gameRaw) {
    const game =
      gameRaw && String(gameRaw) !== 'hub'
        ? String(gameRaw).slice(0, 32)
        : ''
    try {
      if (game) await this.ctx.storage.put(ROOM_GAME_KEY, game)
      else await this.ctx.storage.delete(ROOM_GAME_KEY)
    } catch {
      /* ignore */
    }
    if (!code) return
    const peers = countOpenPeers(this.ctx.getWebSockets())
    if (peers <= 0) return
    this.ctx.waitUntil(
      publishRoomPresence(this.env, code, peers, 'progress', {
        game: game || null,
      }),
    )
  }

  async publishLeavePresence(ws, codeHint, roleHint, closeMeta) {
    let code = codeHint || ''
    let role = roleHint || ''
    if (!code || !role) {
      const att = socketAttachment(ws)
      if (att) {
        if (!code && att.code) code = String(att.code)
        if (!role && att.role) role = String(att.role)
      }
    }
    if (!code) {
      try {
        code = String((await this.ctx.storage.get(ROOM_CODE_KEY)) || '')
      } catch {
        code = ''
      }
    }
    const peers = countOpenPeers(this.ctx.getWebSockets(), ws)
    if (code) {
      const game = await this.readActiveGame()
      await publishRoomPresence(this.env, code, peers, 'leave', {
        role: role || null,
        game: game || null,
        ...(closeMeta && typeof closeMeta === 'object' ? closeMeta : {}),
      })
    }
    if (peers === 0) {
      await this.clearLifetime()
    }
    return { code, role, peers }
  }

  /** 满 TTL：踢掉所有连接，并从在线目录摘掉 */
  async dissolve(reason) {
    let code = ''
    try {
      code = String((await this.ctx.storage.get(ROOM_CODE_KEY)) || '')
    } catch {
      /* ignore */
    }
    for (const ws of this.ctx.getWebSockets()) {
      if (!code) {
        try {
          const att = ws.deserializeAttachment()
          if (att && typeof att === 'object' && att.code) {
            code = String(att.code)
          }
        } catch {
          /* ignore */
        }
      }
      try {
        ws.close(4001, 'room-expired')
      } catch {
        /* ignore */
      }
    }
    await this.clearLifetime()
    console.log(
      JSON.stringify({
        tag: 'peer-room',
        event: 'expire',
        code,
        reason: String(reason || ''),
      }),
    )
    if (code) {
      this.ctx.waitUntil(
        publishRoomPresence(this.env, code, 0, 'expire', {
          reason: String(reason || ''),
        }),
      )
    }
  }

  async alarm() {
    await this.dissolve('alarm')
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const code = roomCodeFromRequest(request)
    const openedAt = Number((await this.ctx.storage.get(ROOM_OPENED_KEY)) || 0)
    if (openedAt > 0 && Date.now() - openedAt >= ROOM_TTL_MS) {
      await this.dissolve('ttl-precheck')
    }

    const live = this.ctx.getWebSockets().filter((s) => {
      try {
        const rs = s.readyState
        if (rs === 2 || rs === 3) return false
      } catch {
        /* keep */
      }
      const att = socketAttachment(s)
      return !(att && att.left)
    })
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    // 空房：由进房 URL 写入是否允许旁观（默认不允许）
    if (live.length === 0) {
      let allow = false
      try {
        const u = new URL(request.url)
        const raw = u.searchParams.get('allowSpectators')
        allow = raw === '1' || raw === 'true'
      } catch {
        allow = false
      }
      try {
        await this.ctx.storage.put(ROOM_ALLOW_SPEC_KEY, allow ? 1 : 0)
      } catch {
        /* ignore */
      }
    }

    const allowSpectators = await this.readAllowSpectators()
    // 重连带 ?role=host|guest：优先顶掉同角色旧连接，避免一人占两席（目录「已满」）。
    // 旧逻辑在「将沦为 spectator」时总先踢 guest，房主重连会误踢真人客人。
    let resumeRole = ''
    try {
      const u = new URL(request.url)
      const raw = String(u.searchParams.get('role') || '')
      if (raw === 'host' || raw === 'guest' || raw === 'spectator') resumeRole = raw
    } catch {
      resumeRole = ''
    }
    let seats = live.slice()
    let role = pickRoomRole(seats)
    let replaced = null
    const kickSeat = (victim) => {
      if (!victim) return
      replaced = socketRole(victim) || replaced || 'guest'
      try {
        victim.close(4003, 'replaced')
      } catch {
        /* ignore */
      }
      seats = seats.filter((ws) => ws !== victim)
      role = pickRoomRole(seats)
    }
    if (resumeRole === 'host' || resumeRole === 'guest') {
      const same = seats.find((ws) => socketRole(ws) === resumeRole)
      if (same) kickSeat(same)
    }
    // 仍无席位且不允许旁观：再顶掉一席，把新连接收成 host/guest
    if (role === 'spectator' && !allowSpectators) {
      const oldSame =
        resumeRole === 'host' || resumeRole === 'guest'
          ? seats.find((ws) => socketRole(ws) === resumeRole)
          : null
      const oldHost = seats.find((ws) => socketRole(ws) === 'host')
      const oldGuest = seats.find((ws) => socketRole(ws) === 'guest')
      // 有 resume 线索时优先同角色；否则顶最旧的对战席（host 通常更早）
      kickSeat(oldSame || oldHost || oldGuest)
    }
    const rejectSpectator = role === 'spectator' && !allowSpectators
    const rejectFull = seats.length >= ROOM_MAX_PEERS

    if (rejectFull || rejectSpectator) {
      const reason = rejectSpectator ? 'no-spectators' : 'room-full'
      const closeCode = rejectSpectator ? 4002 : 4000
      console.log(
        JSON.stringify({
          tag: 'peer-room',
          event: rejectSpectator ? 'reject-no-spectators' : 'reject-full',
          code,
          peers: seats.length,
          allowSpectators,
        }),
      )
      this.ctx.waitUntil(
        peerLog(this.env, {
          event: rejectSpectator ? 'reject-no-spectators' : 'reject-full',
          code,
          peers: seats.length,
          detail: reason,
        }),
      )
      // 先 accept 再立刻关：部分运行时对未 accept 的 close 不稳
      this.ctx.acceptWebSocket(server)
      try {
        server.close(closeCode, reason)
      } catch {
        /* ignore */
      }
      return new Response(null, { status: 101, webSocket: client })
    }

    this.ctx.acceptWebSocket(server)
    if (replaced) {
      console.log(
        JSON.stringify({
          tag: 'peer-room',
          event: 'replace-seat',
          code,
          role,
          replaced,
        }),
      )
    }

    const peers = seats.length + 1
    const activeGame = await this.readActiveGame()

    // 仅对战席（host/guest）入场刷新 24h；旁观不续命
    let openedAtNow = Number((await this.ctx.storage.get(ROOM_OPENED_KEY)) || 0)
    if (role === 'host' || role === 'guest') {
      openedAtNow = Date.now()
      await this.ctx.storage.put(ROOM_OPENED_KEY, openedAtNow)
      await this.ctx.storage.put(ROOM_CODE_KEY, code)
      try {
        await this.ctx.storage.setAlarm(openedAtNow + ROOM_TTL_MS)
      } catch {
        /* ignore */
      }
    }
    try {
      server.serializeAttachment({ role, code })
    } catch {
      /* ignore */
    }
    try {
      server.send(
        JSON.stringify({
          type: '__room',
          role,
          peers,
          game: activeGame || null,
          openedAt: openedAtNow || null,
          allowSpectators,
        }),
      )
    } catch {
      /* ignore */
    }
    for (const peer of seats) {
      try {
        peer.send(JSON.stringify({ type: '__peer-joined', role }))
      } catch {
        /* ignore */
      }
    }

    console.log(
      JSON.stringify({
        tag: 'peer-room',
        event: 'join',
        code,
        role,
        peers,
        game: activeGame || null,
        allowSpectators,
      }),
    )
    // 有人（重）进房：取消「对方暂时离开」的延迟通知
    this.cancelSoftPeerLeftNotify()
    this.ctx.waitUntil(
      publishRoomPresence(this.env, code, peers, 'join', {
        role,
        game: activeGame || null,
        allowSpectators,
      }),
    )
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, message) {
    let text =
      typeof message === 'string'
        ? message
        : new TextDecoder().decode(message)

    let code = ''
    try {
      const att = ws.deserializeAttachment()
      if (att && typeof att === 'object' && att.code) code = String(att.code)
    } catch {
      /* ignore */
    }

    try {
      const msg = JSON.parse(text)
      if (msg && msg.type === '__ping') {
        ws.send(JSON.stringify({ type: '__pong' }))
        return
      }
      // 主动离开：先扣目录人数再关，避免只靠 close 事件时目录不减
      if (msg && msg.type === '__leave') {
        const att = socketAttachment(ws) || {}
        if (!att.left) {
          try {
            ws.serializeAttachment({ ...att, left: true, code: att.code || code })
          } catch {
            /* ignore */
          }
          for (const peer of this.ctx.getWebSockets()) {
            if (peer === ws) continue
            try {
              peer.send(JSON.stringify({ type: '__peer-left' }))
            } catch {
              /* ignore */
            }
          }
          const left = await this.publishLeavePresence(ws, code, att.role || '', {
            reason: 'client-leave',
          })
          console.log(
            JSON.stringify({
              tag: 'peer-room',
              event: 'leave',
              code: left.code,
              role: left.role,
              peers: left.peers,
              reason: 'client-leave',
            }),
          )
        }
        try {
          ws.close(1000, 'client-leave')
        } catch {
          /* ignore */
        }
        return
      }
      // 房主选游戏 / 客户端上报进度：写入房间，24h 内再进仍能看到
      if (msg && msg.type === 'hub-pick' && msg.game) {
        await this.writeActiveGame(code, msg.game)
      } else if (msg && msg.type === '__room-progress') {
        await this.writeActiveGame(code, msg.game)
        // 进度信令只给中继记状态，不转给对端
        return
      }
    } catch {
      /* 非 JSON 也转发 */
    }

    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue
      try {
        peer.send(text)
      } catch {
        /* ignore */
      }
    }
  }

  async webSocketClose(ws, codeNum, reason, wasClean) {
    const att = socketAttachment(ws)
    let code = att && att.code ? String(att.code) : ''
    let role = att && att.role ? String(att.role) : ''
    // __leave 已扣过人数并立刻通知对端，这里只收尾
    if (att && att.left) {
      const peers = countOpenPeers(this.ctx.getWebSockets(), ws)
      console.log(
        JSON.stringify({
          tag: 'peer-room',
          event: 'leave-close',
          code,
          role,
          peers,
          closeCode: codeNum,
          reason: String(reason || ''),
          wasClean: Boolean(wasClean),
        }),
      )
      if (peers === 0) {
        this.ctx.waitUntil(this.clearLifetime())
      }
      return
    }

    try {
      ws.serializeAttachment({
        ...(att || {}),
        left: true,
        code: code || (att && att.code) || '',
        role: role || (att && att.role) || '',
      })
    } catch {
      /* ignore */
    }

    // 目录立刻更新；对端延迟 __peer-left（切后台闪断时宽限内重连可取消）
    const left = await this.publishLeavePresence(ws, code, role, {
      closeCode: codeNum,
      reason: String(reason || ''),
      wasClean: Boolean(wasClean),
    })
    console.log(
      JSON.stringify({
        tag: 'peer-room',
        event: 'leave',
        code: left.code,
        role: left.role,
        peers: left.peers,
        closeCode: codeNum,
        reason: String(reason || ''),
        wasClean: Boolean(wasClean),
      }),
    )
    if (left.peers > 0) {
      this.scheduleSoftPeerLeftNotify()
    }
  }

  async webSocketError(ws) {
    try {
      ws.close(1011, 'error')
    } catch {
      /* ignore */
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') || ''
    const cors = corsHeaders(env, origin)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    try {
      const roomMatch = url.pathname.match(/^\/peer\/room\/(\d{6})$/)
      if (roomMatch) {
        if (!env.ROOMS) {
          return json({ ok: false, error: 'ROOMS Durable Object 未绑定' }, 500, cors)
        }
        const id = env.ROOMS.idFromName(roomMatch[1])
        return env.ROOMS.get(id).fetch(request)
      }

      if (url.pathname === '/peer/rooms/watch') {
        if (!env.ROOM_DIR) {
          return json({ ok: false, error: 'ROOM_DIR Durable Object 未绑定' }, 500, cors)
        }
        if (request.headers.get('Upgrade') !== 'websocket') {
          return new Response('Expected WebSocket', { status: 426, headers: cors })
        }
        return roomDirStub(env).fetch(request)
      }

      if (request.method === 'GET' && url.pathname === '/peer/rooms') {
        if (!env.ROOM_DIR) {
          return json({ ok: true, rooms: [] }, 200, cors)
        }
        const stub = roomDirStub(env)
        const upstream = await stub.fetch(
          new Request('https://room-dir/list', { method: 'GET' }),
        )
        const data = await upstream.json().catch(() => ({ rooms: [] }))
        return json({ ok: true, rooms: Array.isArray(data.rooms) ? data.rooms : [] }, 200, cors)
      }

      // 人机房：客户端 HTTP 登记/心跳/离开（无 WebSocket 占座）
      if (request.method === 'POST' && url.pathname === '/peer/rooms/presence') {
        if (!env.ROOM_DIR) {
          return json({ ok: false, error: 'ROOM_DIR Durable Object 未绑定' }, 500, cors)
        }
        let body
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'bad json' }, 400, cors)
        }
        const code = String(body?.code || '').replace(/\D/g, '').slice(0, 6)
        const peers = Math.max(0, Math.min(8, Number(body?.peers) || 0))
        if (!/^\d{6}$/.test(code)) {
          return json({ ok: false, error: 'bad code' }, 400, cors)
        }
        const gameRaw = body?.game != null ? String(body.game) : ''
        const detail = {
          solo: Boolean(body?.solo) && peers > 0,
          game: gameRaw && gameRaw !== 'hub' ? gameRaw.slice(0, 32) : null,
        }
        if ('allowSpectators' in (body || {})) {
          detail.allowSpectators = Boolean(body.allowSpectators)
        }
        const stub = roomDirStub(env)
        await stub.fetch(
          new Request('https://room-dir/upsert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              peers,
              event: peers > 0 ? 'solo-presence' : 'solo-leave',
              detail,
            }),
          }),
        )
        return json({ ok: true, code, peers }, 200, cors)
      }

      if (request.method === 'GET' && url.pathname === '/peer/logs') {
        if (!env.ROOM_DIR) {
          return json({ ok: true, logs: [] }, 200, cors)
        }
        const stub = roomDirStub(env)
        const upstream = await stub.fetch(
          new Request('https://room-dir/logs', { method: 'GET' }),
        )
        const data = await upstream.json().catch(() => ({ logs: [] }))
        return json({ ok: true, logs: Array.isArray(data.logs) ? data.logs : [] }, 200, cors)
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return json(
          {
            ok: true,
            service: 'between-us',
            jev: Boolean((env.TYPESAFE_API_KEY || '').trim()),
            edit: Boolean(env.MEDIA),
            peer: Boolean(env.ROOMS),
            roomDir: Boolean(env.ROOM_DIR),
            assets: Boolean(env.ASSETS),
          },
          200,
          cors,
        )
      }

      if (request.method === 'POST' && url.pathname === '/jev') {
        return await handleJev(request, env, cors)
      }

      if (request.method === 'GET' && url.pathname === '/edit/status') {
        return json(
          {
            enabled: Boolean(env.MEDIA),
            media: Boolean(env.MEDIA),
          },
          200,
          cors,
        )
      }

      if (url.pathname === '/edit/notes') {
        if (request.method === 'GET') return await handleGetNotes(env, cors)
        if (request.method === 'PUT') return await handlePutNotes(request, env, cors)
      }

      if (request.method === 'POST' && url.pathname === '/edit/upload') {
        return await handleUpload(request, env, cors, url)
      }

      if (request.method === 'POST' && url.pathname === '/edit/object') {
        return await handlePutObject(request, env, cors, url)
      }

      if (request.method === 'DELETE' && url.pathname === '/edit/photo') {
        return await handleDeletePhoto(request, env, cors)
      }

      if (
        (request.method === 'GET' || request.method === 'HEAD') &&
        url.pathname.startsWith('/media/')
      ) {
        return await handleMedia(
          url.pathname.slice('/media/'.length),
          env,
          cors,
          request.method === 'HEAD',
        )
      }

      if (request.method === 'POST' && url.pathname === '/stats/view') {
        return await handleStatsView(request, env, cors)
      }

      if (request.method === 'GET' && url.pathname === '/stats') {
        return await handleGetStats(env, cors)
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request)
      }
      return json({ ok: false, error: 'not found' }, 404, cors)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return json({ ok: false, error: message }, 500, cors)
    }
  },
}

async function handleJev(request, env, cors) {
  const authErr = checkProxyToken(request, env)
  if (authErr) return json({ ok: false, error: authErr }, 401, cors)

  const apiKey = (env.TYPESAFE_API_KEY || '').trim()
  if (!apiKey) {
    return json({ ok: false, error: 'TYPESAFE_API_KEY 未配置' }, 500, cors)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: '请求体必须是 JSON' }, 400, cors)
  }

  if (!body || typeof body !== 'object') {
    return json({ ok: false, error: '无效 JSON' }, 400, cors)
  }
  if (body.state == null) {
    return json({ ok: false, error: '缺少 state' }, 400, cors)
  }
  if (!body.questions || typeof body.questions !== 'object') {
    return json({ ok: false, error: '缺少 questions' }, 400, cors)
  }

  const model =
    (typeof body.model === 'string' && body.model.trim()) ||
    (env.TYPESAFE_MODEL || '').trim() ||
    'jev-latest'

  const upstream = await fetch(TYPESAFE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      state: body.state,
      questions: body.questions,
    }),
  })

  const text = await upstream.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text.slice(0, 500) }
  }

  if (!upstream.ok) {
    return json(
      {
        ok: false,
        error: `TypeSafe HTTP ${upstream.status}`,
        detail: data,
      },
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      cors,
    )
  }

  return json({ ok: true, ...data }, 200, cors)
}

async function handleGetNotes(env, cors) {
  if (!env.MEDIA) {
    return json({ ok: false, error: '未绑定 R2（MEDIA）' }, 503, cors)
  }
  const obj = await env.MEDIA.get(NOTES_KEY)
  if (!obj) {
    return json({ ok: true, notes: null, missing: true }, 200, cors)
  }
  const text = await obj.text()
  let notes
  try {
    notes = JSON.parse(text)
  } catch {
    return json({ ok: false, error: 'notes.json 损坏' }, 500, cors)
  }
  const publicBase = publicMediaOrigin(env)
  const { notes: fixed, changed } = rewriteMediaHostsInNotes(notes, publicBase)
  if (changed) {
    // 顺手把旧 workers.dev 地址写回自定义域，下次不用再改
    try {
      await env.MEDIA.put(NOTES_KEY, JSON.stringify(fixed, null, 2), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
      })
    } catch {
      /* 读仍返回修正后的 */
    }
  }
  return json({ ok: true, notes: fixed, missing: false }, 200, cors)
}

async function handlePutNotes(request, env, cors) {
  const authErr = checkProxyToken(request, env)
  if (authErr) return json({ ok: false, error: authErr }, 401, cors)
  if (!env.MEDIA) {
    return json({ ok: false, error: '未绑定 R2（MEDIA）' }, 503, cors)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: '请求体必须是 JSON' }, 400, cors)
  }
  if (!Array.isArray(body)) {
    return json({ ok: false, error: 'notes must be an array' }, 400, cors)
  }

  await env.MEDIA.put(NOTES_KEY, JSON.stringify(body, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })
  return json({ ok: true }, 200, cors)
}

async function handleUpload(request, env, cors, url) {
  const authErr = checkProxyToken(request, env)
  if (authErr) return json({ ok: false, error: authErr }, 401, cors)
  if (!env.MEDIA) {
    return json({ ok: false, error: '未绑定 R2（MEDIA）' }, 503, cors)
  }

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return json({ ok: false, error: 'multipart required' }, 400, cors)
  }

  const form = await request.formData()
  const file = form.get('file')
  if (!file || typeof file === 'string') {
    return json({ ok: false, error: 'no file' }, 400, cors)
  }

  const size = file.size || 0
  if (size <= 0) return json({ ok: false, error: 'empty file' }, 400, cors)
  if (size > MAX_UPLOAD_BYTES) {
    return json({ ok: false, error: `文件过大（上限 ${MAX_UPLOAD_BYTES} 字节）` }, 413, cors)
  }

  const rawName = (file.name || 'photo.jpg').replace(/[^\w.\u4e00-\u9fff-]+/g, '_')
  const extMatch = /\.(jpe?g|png|webp|gif)$/i.exec(rawName)
  const ext = extMatch ? extMatch[0].toLowerCase().replace('jpeg', 'jpg') : '.jpg'
  const safeExt = ext === '.jpeg' ? '.jpg' : ext
  const safeName = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`
  const key = `photos/${safeName}`

  const bytes = await file.arrayBuffer()
  const mime = file.type || mimeFromExt(ext)
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: mime },
  })

  // 维护照片清单（给拾光页用；墙面主要靠 notes）
  const list = await readPhotosList(env)
  const title = ''
  const src = `${publicMediaOrigin(env, url)}/media/${key}`
  list.push({ src, title, date: new Date().toISOString().slice(0, 10) })
  await env.MEDIA.put(PHOTOS_KEY, JSON.stringify(list, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })

  return json({ ok: true, src, title }, 200, cors)
}

/** 迁移用：保持 photos/原文件名，不自动加时间戳 */
async function handlePutObject(request, env, cors, url) {
  const authErr = checkProxyToken(request, env)
  if (authErr) return json({ ok: false, error: authErr }, 401, cors)
  if (!env.MEDIA) {
    return json({ ok: false, error: '未绑定 R2（MEDIA）' }, 503, cors)
  }

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return json({ ok: false, error: 'multipart required' }, 400, cors)
  }

  const form = await request.formData()
  const file = form.get('file')
  const keyRaw = String(form.get('key') || '').trim().replace(/^\/+/, '')
  if (!file || typeof file === 'string') {
    return json({ ok: false, error: 'no file' }, 400, cors)
  }
  if (!keyRaw.startsWith('photos/') || keyRaw.includes('..') || keyRaw.includes('//')) {
    return json({ ok: false, error: 'key 必须是 photos/ 下的相对路径' }, 400, cors)
  }
  // 允许 photos/name.jpg 或 photos/thumbs/name.jpg
  const parts = keyRaw.split('/')
  const keyOk =
    (parts.length === 2 && parts[0] === 'photos' && parts[1]) ||
    (parts.length === 3 && parts[0] === 'photos' && parts[1] === 'thumbs' && parts[2])
  if (!keyOk) {
    return json(
      { ok: false, error: 'key 形如 photos/name.jpg 或 photos/thumbs/name.jpg' },
      400,
      cors,
    )
  }

  const size = file.size || 0
  if (size <= 0) return json({ ok: false, error: 'empty file' }, 400, cors)
  if (size > MAX_UPLOAD_BYTES) {
    return json({ ok: false, error: `文件过大（上限 ${MAX_UPLOAD_BYTES} 字节）` }, 413, cors)
  }

  const ext = keyRaw.slice(keyRaw.lastIndexOf('.'))
  const bytes = await file.arrayBuffer()
  await env.MEDIA.put(keyRaw, bytes, {
    httpMetadata: { contentType: file.type || mimeFromExt(ext) },
  })

  const src = `${publicMediaOrigin(env, url)}/media/${keyRaw}`
  return json({ ok: true, src, key: keyRaw }, 200, cors)
}

async function handleDeletePhoto(request, env, cors) {
  const authErr = checkProxyToken(request, env)
  if (authErr) return json({ ok: false, error: authErr }, 401, cors)
  if (!env.MEDIA) {
    return json({ ok: false, error: '未绑定 R2（MEDIA）' }, 503, cors)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: '请求体必须是 JSON' }, 400, cors)
  }
  const src = typeof body.src === 'string' ? body.src.trim() : ''
  if (!src) return json({ ok: false, error: 'src required' }, 400, cors)

  const key = mediaKeyFromSrc(src)
  if (!key) return json({ ok: false, error: 'invalid src' }, 400, cors)

  await env.MEDIA.delete(key)
  const list = await readPhotosList(env)
  const next = list.filter((item) => item.src !== src)
  await env.MEDIA.put(PHOTOS_KEY, JSON.stringify(next, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })

  return json({ ok: true, src }, 200, cors)
}

async function handleStatsView(request, env, cors) {
  if (!env.MEDIA) {
    return json({ ok: false, error: '未绑定 R2（MEDIA）' }, 503, cors)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: '请求体必须是 JSON' }, 400, cors)
  }

  const visitorId = typeof body?.visitorId === 'string' ? body.visitorId.trim() : ''
  if (!VISITOR_ID_RE.test(visitorId)) {
    return json({ ok: false, error: 'invalid visitorId' }, 400, cors)
  }

  const pageRaw = typeof body?.page === 'string' ? body.page.trim() : 'home'
  if (pageRaw !== 'home') {
    return json({ ok: false, error: 'unsupported page' }, 400, cors)
  }

  const stats = await readStats(env)
  const bucket = stats.home || { pv: 0, visitors: [] }
  const visitors = Array.isArray(bucket.visitors) ? bucket.visitors.filter(Boolean) : []
  const seen = new Set(visitors)
  const isNewVisitor = !seen.has(visitorId)
  if (isNewVisitor) {
    if (seen.size >= MAX_VISITOR_IDS) {
      return json({ ok: false, error: 'visitor cap reached' }, 429, cors)
    }
    seen.add(visitorId)
  }

  const next = {
    pv: (Number(bucket.pv) || 0) + 1,
    visitors: [...seen],
  }
  stats.home = next
  await env.MEDIA.put(STATS_KEY, JSON.stringify(stats), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })

  return json(
    {
      ok: true,
      page: 'home',
      pv: next.pv,
      uv: next.visitors.length,
      isNewVisitor,
    },
    200,
    cors,
  )
}

async function handleGetStats(env, cors) {
  if (!env.MEDIA) {
    return json({ ok: false, error: '未绑定 R2（MEDIA）' }, 503, cors)
  }
  const stats = await readStats(env)
  const home = stats.home || { pv: 0, visitors: [] }
  const visitors = Array.isArray(home.visitors) ? home.visitors : []
  return json(
    {
      ok: true,
      home: {
        pv: Number(home.pv) || 0,
        uv: visitors.length,
      },
    },
    200,
    cors,
  )
}

async function readStats(env) {
  const obj = await env.MEDIA.get(STATS_KEY)
  if (!obj) return {}
  try {
    const data = JSON.parse(await obj.text())
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

async function handleMedia(keyPath, env, cors, headOnly = false) {
  if (!env.MEDIA) {
    return json({ ok: false, error: '未绑定 R2（MEDIA）' }, 503, cors)
  }
  const key = decodeURIComponent(keyPath).replace(/^\/+/, '')
  if (!key.startsWith('photos/') || key.includes('..')) {
    return json({ ok: false, error: 'invalid path' }, 400, cors)
  }
  const obj = await env.MEDIA.get(key)
  if (!obj) {
    return json({ ok: false, error: 'not found' }, 404, cors)
  }
  const headers = new Headers(cors)
  headers.set(
    'Content-Type',
    obj.httpMetadata?.contentType || mimeFromExt(key.slice(key.lastIndexOf('.'))),
  )
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  if (obj.size != null) headers.set('Content-Length', String(obj.size))
  if (headOnly) {
    return new Response(null, { status: 200, headers })
  }
  return new Response(obj.body, { status: 200, headers })
}

async function readPhotosList(env) {
  const obj = await env.MEDIA.get(PHOTOS_KEY)
  if (!obj) return []
  try {
    const list = JSON.parse(await obj.text())
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function mediaKeyFromSrc(src) {
  try {
    if (src.includes('/media/')) {
      const path = src.split('/media/')[1] || ''
      const key = decodeURIComponent(path.split('?')[0]).replace(/^\/+/, '')
      if (key.startsWith('photos/') && !key.includes('..')) return key
      return null
    }
    const normalized = src.replace(/^\.\//, '').replace(/^\//, '')
    if (normalized.startsWith('photos/') && !normalized.includes('..')) {
      return normalized
    }
  } catch {
    /* ignore */
  }
  return null
}

function mimeFromExt(ext) {
  const e = (ext || '').toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.webp') return 'image/webp'
  if (e === '.gif') return 'image/gif'
  return 'image/jpeg'
}

/** 对外 URL 根：env.PUBLIC_ORIGIN > 非 workers.dev 的请求 Host > 默认自定义域 */
function publicMediaOrigin(env, url) {
  const configured = String(env.PUBLIC_ORIGIN || '').trim().replace(/\/$/, '')
  if (configured) return configured
  if (url && url.origin && !/\.workers\.dev$/i.test(url.host || '')) {
    return url.origin
  }
  return DEFAULT_PUBLIC_ORIGIN
}

function rewriteMediaHostsInNotes(notes, publicBase) {
  if (!Array.isArray(notes) || !publicBase) {
    return { notes, changed: false }
  }
  let changed = false
  const next = notes.map((item) => {
    if (!item || typeof item !== 'object') return item
    const src = typeof item.src === 'string' ? item.src : ''
    if (!src || !src.includes('/media/')) return item
    try {
      const u = new URL(src)
      if (!/\.workers\.dev$/i.test(u.host) && u.origin === publicBase) return item
      if (!/\.workers\.dev$/i.test(u.host)) return item
      const path = u.pathname + u.search
      changed = true
      return { ...item, src: `${publicBase}${path}` }
    } catch {
      return item
    }
  })
  return { notes: next, changed }
}

function checkProxyToken(request, env) {
  const needed = (env.PROXY_TOKEN || '').trim()
  if (!needed) return null
  const got = (request.headers.get('X-Between-Us-Token') || '').trim()
  if (got && got === needed) return null
  return '未授权'
}

function allowedOrigins(env) {
  const raw = (env.ALLOWED_ORIGINS || '').trim()
  if (!raw) return DEFAULT_ORIGINS
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function corsHeaders(env, origin) {
  const list = allowedOrigins(env)
  const allow = origin && list.includes(origin) ? origin : list[0] || '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Between-Us-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...cors,
    },
  })
}
