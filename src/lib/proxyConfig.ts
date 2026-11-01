/** Cloudflare Worker 公共地址（Jev + 钉照片共用） */

const DEFAULT_PROXY = 'https://dry-term-0bf5.davis121776003.workers.dev'

export function cloudProxyBaseUrl(): string {
  const raw = (import.meta.env.VITE_JEV_PROXY_URL as string | undefined)?.trim()
  return (raw || DEFAULT_PROXY).replace(/\/$/, '')
}

export function cloudProxyToken(): string {
  return ((import.meta.env.VITE_JEV_PROXY_TOKEN as string | undefined) || '').trim()
}

export function isCloudProxyConfigured(): boolean {
  return cloudProxyBaseUrl().length > 0
}
