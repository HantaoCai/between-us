import type { PointerEvent as ReactPointerEvent } from 'react'

/** 你画我猜 / 你画你猜 共用画布笔触 */

export type DrawPoint = { x: number; y: number }

export type DrawStroke = {
  points: DrawPoint[]
  color: string
  width?: number
  erase?: boolean
}

export const DRAW_CANVAS_BG = '#f7f4ee'
export const DRAW_INK = '#2a2218'
export const DRAW_PEN_WIDTH = 5

export function clearDrawCanvas(
  canvas: HTMLCanvasElement,
  bg = DRAW_CANVAS_BG,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight)
}

export function paintStroke(
  canvas: HTMLCanvasElement,
  s: DrawStroke,
  defaults?: { penWidth?: number; eraserWidth?: number },
) {
  const ctx = canvas.getContext('2d')
  if (!ctx || s.points.length < 2) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const erase = !!s.erase
  const pen = defaults?.penWidth ?? DRAW_PEN_WIDTH
  const eraser = defaults?.eraserWidth ?? 18
  ctx.save()
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
  if (!erase) ctx.strokeStyle = s.color
  ctx.lineWidth = s.width ?? (erase ? eraser : pen)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(s.points[0].x * w, s.points[0].y * h)
  for (let i = 1; i < s.points.length; i++) {
    ctx.lineTo(s.points[i].x * w, s.points[i].y * h)
  }
  ctx.stroke()
  ctx.restore()
}

export function relPointFromEvent(
  e: ReactPointerEvent<HTMLCanvasElement>,
): DrawPoint {
  const rect = e.currentTarget.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  }
}

/** 按宿主可用空间设置 CSS 尺寸与 DPR 缓冲；返回逻辑边长 */
export function fitDrawCanvas(
  canvas: HTMLCanvasElement,
  opts: {
    host: HTMLElement
    chrome?: number
    max?: number
    min?: number
    bg?: string
  },
): number {
  const chrome = opts.chrome ?? 220
  const max = opts.max ?? 560
  const min = opts.min ?? 240
  const bg = opts.bg ?? DRAW_CANVAS_BG
  const byWidth = opts.host.clientWidth
  const byHeight = Math.floor(window.innerHeight - chrome)
  const size = Math.max(min, Math.min(byWidth, byHeight, max))
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const board = canvas.parentElement
  if (board) board.style.width = `${size}px`
  canvas.style.width = `${size}px`
  canvas.style.height = `${size}px`
  canvas.width = Math.floor(size * dpr)
  canvas.height = Math.floor(size * dpr)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, size, size)
  }
  return size
}

/** 画布导出 JPEG；可缩小边长方便 Peer 传输 */
export function canvasToJpeg(
  source: HTMLCanvasElement,
  opts?: { quality?: number; maxEdge?: number; bg?: string },
): string {
  const quality = opts?.quality ?? 0.78
  const maxEdge = opts?.maxEdge
  const bg = opts?.bg ?? DRAW_CANVAS_BG
  let w = source.width
  let h = source.height
  if (maxEdge && Math.max(w, h) > maxEdge) {
    const scale = maxEdge / Math.max(w, h)
    w = Math.max(1, Math.round(w * scale))
    h = Math.max(1, Math.round(h * scale))
  }
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const ctx = tmp.getContext('2d')
  if (!ctx) return source.toDataURL('image/png')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  return tmp.toDataURL('image/jpeg', quality)
}

export function normalizeGuess(text: string) {
  return text.trim().replace(/\s+/g, '').toLowerCase()
}

export function guessesMatch(a: string, b: string) {
  return normalizeGuess(a) === normalizeGuess(b) && normalizeGuess(a).length > 0
}
