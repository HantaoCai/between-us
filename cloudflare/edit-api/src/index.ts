export type Env = {
  BUCKET: R2Bucket
  EDIT_PASSWORD: string
  /** 逗号分隔的允许 Origin；空则用默认列表 */
  ALLOWED_ORIGINS?: string
}

const NOTES_KEY = 'data/notes.json'
const PHOTOS_KEY = 'data/photos.json'
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

const DEFAULT_ORIGINS = [
  'https://hantaocai.github.io',
  'http://127.0.0.1:43217',
  'http://localhost:43217',
]

type PhotoItem = {
  src: string
  title: string
  date?: string
  slug?: string
}

function parseAllowedOrigins(env: Env): string[] {
  const raw = env.ALLOWED_ORIGINS?.trim()
  if (!raw) return DEFAULT_ORIGINS
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function corsHeaders(env: Env, request: Request): Headers {
  const headers = new Headers()
  const origin = request.headers.get('Origin') || ''
  const allowed = parseAllowedOrigins(env)
  if (origin && allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  } else if (!origin) {
    // 非浏览器脚本（备份）不带 Origin
  } else if (allowed.includes('*')) {
    headers.set('Access-Control-Allow-Origin', '*')
  }
  headers.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS')
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Edit-Password, Authorization',
  )
  headers.set('Access-Control-Max-Age', '86400')
  return headers
}

function json(env: Env, request: Request, status: number, data: unknown): Response {
  const headers = corsHeaders(env, request)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(data), { status, headers })
}

function text(env: Env, request: Request, status: number, body: string): Response {
  const headers = corsHeaders(env, request)
  headers.set('Content-Type', 'text/plain; charset=utf-8')
  return new Response(body, { status, headers })
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aa = enc.encode(a)
  const bb = enc.encode(b)
  if (aa.length !== bb.length) {
    // 仍比较一次，降低长度侧信道；结果恒为 false
    let diff = aa.length ^ bb.length
    const n = Math.min(aa.length, bb.length)
    for (let i = 0; i < n; i++) diff |= aa[i]! ^ bb[i]!
    return false
  }
  let diff = 0
  for (let i = 0; i < aa.length; i++) diff |= aa[i]! ^ bb[i]!
  return diff === 0
}

function readPassword(request: Request): string {
  const header = request.headers.get('X-Edit-Password')
  if (header) return header
  const auth = request.headers.get('Authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(auth)
  return m?.[1]?.trim() || ''
}

function requireAuth(env: Env, request: Request): Response | null {
  const expected = env.EDIT_PASSWORD || ''
  if (!expected) {
    return json(env, request, 503, { error: 'EDIT_PASSWORD not configured' })
  }
  const got = readPassword(request)
  if (!got || !timingSafeEqual(got, expected)) {
    return json(env, request, 401, { error: '口令错误' })
  }
  return null
}

function contentTypeForKey(key: string): string {
  const lower = key.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function safePhotoName(name: string): string {
  const base = name.replace(/[^\w.\u4e00-\u9fff-]+/g, '_').slice(0, 80)
  return base || `photo-${Date.now()}.jpg`
}

function objectKeyFromSrc(src: string, workerOrigin: string): string | null {
  const value = src.trim()
  if (!value) return null
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value)
      if (url.origin !== workerOrigin) return null
      const path = url.pathname.replace(/^\/+/, '')
      if (!path.startsWith('files/')) return null
      return path.slice('files/'.length)
    }
  } catch {
    return null
  }
  const normalized = value.replace(/^\.\//, '').replace(/^\//, '')
  if (normalized.startsWith('photos/') && !normalized.includes('..')) {
    return normalized
  }
  if (normalized.startsWith('files/')) return normalized.slice('files/'.length)
  return null
}

async function readJsonObject<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key)
  if (!obj) return null
  return (await obj.json()) as T
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) })
    }

    try {
      if (request.method === 'GET' && path === '/status') {
        return json(env, request, 200, {
          enabled: true,
          mode: 'remote',
          needsPassword: true,
        })
      }

      if (request.method === 'POST' && path === '/auth') {
        const denied = requireAuth(env, request)
        if (denied) return denied
        return json(env, request, 200, { ok: true })
      }

      if (request.method === 'GET' && path === '/notes') {
        const list = await readJsonObject<unknown[]>(env.BUCKET, NOTES_KEY)
        if (!list) {
          return json(env, request, 404, { error: 'not seeded' })
        }
        return json(env, request, 200, list)
      }

      if (request.method === 'PUT' && path === '/notes') {
        const denied = requireAuth(env, request)
        if (denied) return denied
        const body = (await request.json()) as unknown
        if (!Array.isArray(body)) {
          return json(env, request, 400, { error: 'notes must be an array' })
        }
        await env.BUCKET.put(NOTES_KEY, JSON.stringify(body, null, 2), {
          httpMetadata: { contentType: 'application/json; charset=utf-8' },
        })
        return json(env, request, 200, { ok: true })
      }

      if (request.method === 'GET' && path === '/photos') {
        const list = (await readJsonObject<PhotoItem[]>(env.BUCKET, PHOTOS_KEY)) || []
        return json(env, request, 200, list)
      }

      if (request.method === 'PUT' && path === '/photos') {
        const denied = requireAuth(env, request)
        if (denied) return denied
        const body = (await request.json()) as unknown
        if (!Array.isArray(body)) {
          return json(env, request, 400, { error: 'photos must be an array' })
        }
        await env.BUCKET.put(PHOTOS_KEY, JSON.stringify(body, null, 2), {
          httpMetadata: { contentType: 'application/json; charset=utf-8' },
        })
        return json(env, request, 200, { ok: true })
      }

      if (request.method === 'POST' && path === '/upload') {
        const denied = requireAuth(env, request)
        if (denied) return denied
        const form = await request.formData()
        const file = form.get('file')
        if (!(file instanceof File)) {
          return json(env, request, 400, { error: 'no file' })
        }
        if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
          return json(env, request, 400, { error: 'file too large' })
        }
        const original = safePhotoName(file.name || `photo-${Date.now()}.jpg`)
        const extMatch = /\.[a-z0-9]+$/i.exec(original)
        const ext = extMatch?.[0]?.toLowerCase() || '.jpg'
        const base = original.slice(0, original.length - ext.length) || `photo-${Date.now()}`
        const key = `photos/${base}-${Date.now()}${ext}`
        const bytes = await file.arrayBuffer()
        await env.BUCKET.put(key, bytes, {
          httpMetadata: {
            contentType: file.type || contentTypeForKey(key),
          },
        })
        const src = `${url.origin}/files/${key}`
        const list = (await readJsonObject<PhotoItem[]>(env.BUCKET, PHOTOS_KEY)) || []
        list.push({ src, title: base })
        await env.BUCKET.put(PHOTOS_KEY, JSON.stringify(list, null, 2), {
          httpMetadata: { contentType: 'application/json; charset=utf-8' },
        })
        return json(env, request, 200, { ok: true, src, title: base })
      }

      if (request.method === 'DELETE' && path === '/photo') {
        const denied = requireAuth(env, request)
        if (denied) return denied
        const body = (await request.json().catch(() => ({}))) as { src?: string }
        const src = body.src?.trim()
        if (!src) return json(env, request, 400, { error: 'src required' })
        const key = objectKeyFromSrc(src, url.origin)
        const list = (await readJsonObject<PhotoItem[]>(env.BUCKET, PHOTOS_KEY)) || []
        const next = list.filter((item) => item.src !== src)
        await env.BUCKET.put(PHOTOS_KEY, JSON.stringify(next, null, 2), {
          httpMetadata: { contentType: 'application/json; charset=utf-8' },
        })
        if (key) {
          await env.BUCKET.delete(key)
          const thumbKey = key.replace(/^photos\//, 'photos/thumbs/')
          if (thumbKey !== key) await env.BUCKET.delete(thumbKey)
        }
        return json(env, request, 200, { ok: true, src })
      }

      if (request.method === 'GET' && path.startsWith('/files/')) {
        const key = path.slice('/files/'.length)
        if (!key || key.includes('..')) {
          return text(env, request, 400, 'bad key')
        }
        const obj = await env.BUCKET.get(key)
        if (!obj) return text(env, request, 404, 'not found')
        const headers = corsHeaders(env, request)
        headers.set('Content-Type', obj.httpMetadata?.contentType || contentTypeForKey(key))
        headers.set('Cache-Control', 'public, max-age=31536000, immutable')
        if (obj.httpEtag) headers.set('ETag', obj.httpEtag)
        return new Response(obj.body, { status: 200, headers })
      }

      return json(env, request, 404, { error: 'unknown edit route' })
    } catch (error) {
      console.error('[edit-api]', error)
      return json(env, request, 500, {
        error: error instanceof Error ? error.message : 'server error',
      })
    }
  },
}
