import { cloudProxyBaseUrl, isCloudProxyConfigured } from './proxyConfig'
import { getOrCreateVisitorId } from './visitorId'

export type HomeStats = {
  pv: number
  uv: number
}

function statsUrl(path: string): string {
  return `${cloudProxyBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
}

/** 本地 / Vite 开发态：只读计数，不上报，避免把调试记进线上 UV */
function shouldSkipStatsReport(): boolean {
  if (import.meta.env.DEV) return true
  if (typeof window === 'undefined') return true
  const host = window.location.hostname
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.local')
  )
}

/** 拾光页进入时：生产且能持久化 visitorId 才上报；否则只读当前 UV */
export async function reportHomeView(): Promise<HomeStats | null> {
  if (!isCloudProxyConfigured()) return null
  if (typeof window === 'undefined') return null

  if (shouldSkipStatsReport()) {
    return fetchHomeStats()
  }

  const visitorId = getOrCreateVisitorId()
  if (!visitorId) {
    return fetchHomeStats()
  }

  try {
    const res = await fetch(statsUrl('/stats/view'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, page: 'home' }),
      keepalive: true,
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      pv?: number
      uv?: number
    }
    if (!res.ok || !data.ok) return null
    return {
      pv: Number(data.pv) || 0,
      uv: Number(data.uv) || 0,
    }
  } catch {
    return null
  }
}

export async function fetchHomeStats(): Promise<HomeStats | null> {
  if (!isCloudProxyConfigured()) return null
  try {
    const res = await fetch(statsUrl('/stats'))
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      home?: { pv?: number; uv?: number }
    }
    if (!res.ok || !data.ok || !data.home) return null
    return {
      pv: Number(data.home.pv) || 0,
      uv: Number(data.home.uv) || 0,
    }
  } catch {
    return null
  }
}
