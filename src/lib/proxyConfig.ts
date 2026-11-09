/** Cloudflare Worker 公共地址（钉照片 / 双人房 / Jev / 统计共用） */

const DEFAULT_PROXY = 'https://hantao-jiajia.cn'
const EDIT_TOKEN_KEY = 'between-us-edit-token'

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

/** 构建期写入的 Token（Jev 等仍可用；墙面编辑优先用会话口令） */
export function cloudProxyToken(): string {
  return envString('VITE_CLOUD_PROXY_TOKEN', 'VITE_JEV_PROXY_TOKEN')
}

export function isCloudProxyConfigured(): boolean {
  return cloudProxyBaseUrl().length > 0
}

export function readSessionEditToken(): string {
  try {
    return (sessionStorage.getItem(EDIT_TOKEN_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function writeSessionEditToken(token: string) {
  const next = token.trim()
  try {
    if (next) sessionStorage.setItem(EDIT_TOKEN_KEY, next)
    else sessionStorage.removeItem(EDIT_TOKEN_KEY)
  } catch {
    /* private mode */
  }
}

export function clearSessionEditToken() {
  writeSessionEditToken('')
}

/** 墙面写接口：会话口令优先，否则回退构建期 Token */
export function resolveEditToken(): string {
  return readSessionEditToken() || cloudProxyToken()
}
