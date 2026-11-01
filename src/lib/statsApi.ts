import { cloudProxyBaseUrl, isCloudProxyConfigured } from './proxyConfig'
import { getOrCreateVisitorId } from './visitorId'

export type HomeStats = {
  pv: number
  uv: number
}

function statsUrl(path: string): string {
  return `${cloudProxyBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
}

/** 拾光页进入时上报一次（PV+1；新 visitorId 则 UV+1）；成功则带回最新计数 */
export async function reportHomeView(): Promise<HomeStats | null> {
  if (!isCloudProxyConfigured()) return null
  if (typeof window === 'undefined') return null

  try {
    const visitorId = getOrCreateVisitorId()
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
