import { cloudProxyBaseUrl, isCloudProxyConfigured } from './proxyConfig'

export type OnlineRoom = {
  code: string
  peers: number
  at: number
}

/** 拉当前仍有端连着的房间（Worker 登记；关页/断线会消失） */
export async function fetchOnlineRooms(): Promise<OnlineRoom[]> {
  if (!isCloudProxyConfigured()) return []
  try {
    const res = await fetch(`${cloudProxyBaseUrl()}/peer/rooms`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { rooms?: OnlineRoom[] }
    if (!Array.isArray(data.rooms)) return []
    return data.rooms.filter(
      (r) =>
        r &&
        typeof r.code === 'string' &&
        /^\d{6}$/.test(r.code) &&
        typeof r.peers === 'number' &&
        r.peers > 0,
    )
  } catch {
    return []
  }
}
