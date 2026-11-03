/** Cloudflare Worker 公共地址（钉照片 / 双人房 / Jev / 统计共用） */

const DEFAULT_PROXY = 'https://hantao-jiajia.cn'

function envString(...keys: string[]): string {
  for (const key of keys) {
    const raw = (import.meta.env[key] as string | undefined)?.trim()
    if (raw) return raw
  }
  return ''
}

export function cloudProxyBaseUrl(): string {
  const raw = envString('VITE_CLOUD_PROXY_URL', 'VITE_JEV_PROXY_URL')
  return (raw || DEFAULT_PROXY).replace(/\/$/, '')
}

export function cloudProxyToken(): string {
  return envString('VITE_CLOUD_PROXY_TOKEN', 'VITE_JEV_PROXY_TOKEN')
}

export function isCloudProxyConfigured(): boolean {
  return cloudProxyBaseUrl().length > 0
}
