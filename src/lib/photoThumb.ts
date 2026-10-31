/** 墙上用的缩略图路径：./photos/a.jpg → ./photos/thumbs/a.jpg */
export function photoThumbSrc(src: string): string {
  const value = src.trim()
  if (!value) return ''
  if (/^(https?:|data:|blob:)/i.test(value)) return value

  const normalized = value.replace(/^\.\//, '').replace(/^\//, '')
  const match = /^photos\/([^/]+)$/.exec(normalized)
  if (!match) return value.startsWith('./') ? value : `./${normalized}`

  return `./photos/thumbs/${match[1]}`
}
