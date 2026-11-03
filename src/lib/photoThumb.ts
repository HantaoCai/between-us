/** 墙上用的缩略图路径：./photos/a.jpg → ./photos/thumbs/a.jpg；R2 全图 URL 同理改 thumbs */
export function photoThumbSrc(src: string): string {
  const value = src.trim()
  if (!value) return ''
  if (/^(data:|blob:)/i.test(value)) return value

  if (/^https?:/i.test(value)) {
    try {
      const u = new URL(value)
      const m = /^\/media\/photos\/([^/]+)$/.exec(u.pathname)
      if (m) {
        u.pathname = `/media/photos/thumbs/${m[1]}`
        return u.href
      }
    } catch {
      /* keep original */
    }
    return value
  }

  const normalized = value.replace(/^\.\//, '').replace(/^\//, '')
  const match = /^photos\/([^/]+)$/.exec(normalized)
  if (!match) return value.startsWith('./') ? value : `./${normalized}`

  return `./photos/thumbs/${match[1]}`
}
