/** 前端只打 Cloudflare Worker，不接触 TypeSafe key */

const DEFAULT_PROXY = 'https://dry-term-0bf5.davis121776003.workers.dev'

export function jevProxyBaseUrl(): string {
  const raw = (import.meta.env.VITE_JEV_PROXY_URL as string | undefined)?.trim()
  return (raw || DEFAULT_PROXY).replace(/\/$/, '')
}

export function jevProxyToken(): string {
  return ((import.meta.env.VITE_JEV_PROXY_TOKEN as string | undefined) || '').trim()
}

export function isJevConfigured(): boolean {
  return jevProxyBaseUrl().length > 0
}
