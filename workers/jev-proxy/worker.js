/**
 * Between Us · Cloudflare Worker
 *
 * 路径：
 *   GET  /           → 健康检查
 *   POST /jev        → 代理 TypeSafe Jev（systemone）
 *   （以后可加 POST /upload、PUT /notes 钉照片）
 *
 * Secrets（Workers → Settings → Variables）：
 *   TYPESAFE_API_KEY   必填，与 quant-lab 同一把即可
 *   PROXY_TOKEN        可选；设了则请求头要带 X-Between-Us-Token
 *
 * Variables（明文）：
 *   TYPESAFE_MODEL     可选，默认 jev-latest
 *   ALLOWED_ORIGINS    可选，逗号分隔；默认含 localhost 与 GitHub Pages
 */

const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone'

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
        return json({ ok: true, service: 'between-us-jev' }, 200, cors)
      }

      if (request.method === 'POST' && url.pathname === '/jev') {
        return await handleJev(request, env, cors)
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

  const payload = {
    model,
    state: body.state,
    questions: body.questions,
  }

  const upstream = await fetch(TYPESAFE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
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
  const allow =
    origin && list.includes(origin)
      ? origin
      : list[0] || '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
