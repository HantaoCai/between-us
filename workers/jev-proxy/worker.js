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
 *
 * Secrets：
 *   TYPESAFE_API_KEY   Jev 用
 *   PROXY_TOKEN        可选；写接口与 /jev 校验 X-Between-Us-Token
 *
 * Variables：
 *   TYPESAFE_MODEL / ALLOWED_ORIGINS
 *
 * Bindings：
 *   MEDIA  → R2 bucket（钉照片必绑）
 */

const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone'
const NOTES_KEY = 'data/notes.json'
const PHOTOS_KEY = 'data/photos.json'
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

const DEFAULT_ORIGINS = [
  'http://127.0.0.1:43217',
  'http://localhost:43217',
  'https://hantaocai.github.io',
]

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') || ''
    const cors = corsHeaders(env, origin)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    try {
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        return json(
          {
            ok: true,
            service: 'between-us',
            jev: Boolean((env.TYPESAFE_API_KEY || '').trim()),
            edit: Boolean(env.MEDIA),
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
  return json({ ok: true, notes, missing: false }, 200, cors)
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
  const base =
    rawName.replace(/\.[^.]+$/, '').slice(0, 40) || `photo-${Date.now()}`
  const safeName = `${Date.now()}-${base}${ext === '.jpeg' ? '.jpg' : ext}`
  const key = `photos/${safeName}`

  const bytes = await file.arrayBuffer()
  const mime = file.type || mimeFromExt(ext)
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: mime },
  })

  // 维护照片清单（给拾光页用；墙面主要靠 notes）
  const list = await readPhotosList(env)
  const title = base
  const src = `${url.origin}/media/${key}`
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

  const src = `${url.origin}/media/${keyRaw}`
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
