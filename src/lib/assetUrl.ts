/** 把 ./photos/x 解析成当前站点下可请求的地址（兼容 HashRouter + base: './'） */
export function assetUrl(src: string): string {
  const value = src.trim()
  if (!value) return ''
  if (/^(https?:|data:|blob:)/i.test(value)) return value

  const path = value.replace(/^\.\//, '')
  if (typeof window === 'undefined') {
    const base = import.meta.env.BASE_URL || './'
    if (base === './' || base === '.') return `./${path}`
    return `${base.replace(/\/?$/, '/')}${path}`
  }

  // 去掉 hash，避免相对路径相对到错误位置
  const page = `${window.location.origin}${window.location.pathname}`
  const base = page.endsWith('/') ? page : page.replace(/[^/]+$/, '')
  return new URL(path, base).href
}
