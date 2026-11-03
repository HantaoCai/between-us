/**
 * Between Us · Cloudflare Worker
 *
 * 路径：
 *   GET  /  /health              → 健康检查
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
 * Secrets：
 *   TYPESAFE_API_KEY   Jev 用
 *   PROXY_TOKEN        可选；写接口与 /jev 校验 X-Between-Us-Token
 *
 * Variables：
 *   TYPESAFE_MODEL / ALLOWED_ORIGINS / PUBLIC_ORIGIN
 *
 * Bindings：
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
]

/** 对外媒体域名：优先自定义域，避免钉照片写成 workers.dev（国内常打不开） */
const DEFAULT_PUBLIC_ORIGIN = 'https://hantao-jiajia.cn'

const PEER_LOG_KEY = 'log:recent'
const PEER_LOG_MAX = 100

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
    for (const [key, value] of listed) {
      const code = key.slice('room:'.length)
      const peers = value && typeof value === 'object' ? Number(value.peers) || 0 : 0
      const at = value && typeof value === 'object' ? Number(value.at) || 0 : 0
      if (!/^\d{6}$/.test(code) || peers <= 0) continue
      rooms.push({ code, peers, at })
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
      if (peers <= 0) {
        await this.ctx.storage.delete(key)
      } else {
        await this.ctx.storage.put(key, { peers, at: Date.now() })
      }
      await this.appendLog({ event, code, peers, detail: body?.detail || null })
      console.log(JSON.stringify({ tag: 'peer-dir', event, code, peers }))
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
 */
const ROOM_MAX_PEERS = 8

function socketRole(ws) {
  try {
    const att = ws.deserializeAttachment()
    if (att && typeof att === 'object' && att.role) return String(att.role)
  } catch {
    /* ignore */
  }
  return ''
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

export class RoomBroker {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const code = roomCodeFromRequest(request)
    const live = this.ctx.getWebSockets()
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    if (live.length >= ROOM_MAX_PEERS) {
      console.log(
        JSON.stringify({
          tag: 'peer-room',
          event: 'reject-full',
          code,
          peers: live.length,
        }),
      )
      this.ctx.waitUntil(
        peerLog(this.env, {
          event: 'reject-full',
          code,
          peers: live.length,
          detail: 'max-8',
        }),
      )
      // 先 accept 再立刻关：部分运行时对未 accept 的 close 不稳
      this.ctx.acceptWebSocket(server)
      try {
        server.close(4000, 'room-full')
      } catch {
        /* ignore */
      }
      return new Response(null, { status: 101, webSocket: client })
    }

    this.ctx.acceptWebSocket(server)

    const role = pickRoomRole(live)
    const peers = live.length + 1
    try {
      server.serializeAttachment({ role, code })
    } catch {
      /* ignore */
    }
    try {
      server.send(JSON.stringify({ type: '__room', role, peers }))
    } catch {
      /* ignore */
    }
    for (const peer of live) {
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
      }),
    )
    this.ctx.waitUntil(
      publishRoomPresence(this.env, code, peers, 'join', { role }),
    )
    return new Response(null, { status: 101, webSocket: client })
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
    let code = ''
    let role = ''
    try {
      const att = ws.deserializeAttachment()
      if (att && typeof att === 'object') {
        if (att.code) code = String(att.code)
        if (att.role) role = String(att.role)
      }
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

    const peers = this.ctx.getWebSockets().filter((s) => s !== ws).length
    console.log(
      JSON.stringify({
        tag: 'peer-room',
        event: 'leave',
        code,
        role,
        peers,
        closeCode: codeNum,
        reason: String(reason || ''),
        wasClean: Boolean(wasClean),
      }),
    )
    if (code) {
      this.ctx.waitUntil(
        publishRoomPresence(this.env, code, peers, 'leave', {
          role,
          closeCode: codeNum,
          reason: String(reason || ''),
        }),
      )
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

      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        return json(
          {
            ok: true,
            service: 'between-us',
            jev: Boolean((env.TYPESAFE_API_KEY || '').trim()),
            edit: Boolean(env.MEDIA),
            peer: Boolean(env.ROOMS),
            roomDir: Boolean(env.ROOM_DIR),
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

      if (request.method === 'GET' && url.pathname.startsWith('/media/')) {
        return await handleMedia(url.pathname.slice('/media/'.length), env, cors)
      }

      if (request.method === 'POST' && url.pathname === '/stats/view') {
        return await handleStatsView(request, env, cors)
      }

      if (request.method === 'GET' && url.pathname === '/stats') {
        return await handleGetStats(env, cors)
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

async function handleMedia(keyPath, env, cors) {
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
