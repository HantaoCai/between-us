import type { NoteTone, StickyNote } from './types'

const TONES: NoteTone[] = ['butter', 'mint', 'sky', 'peach', 'rose', 'cream']

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function nextTone(index: number): NoteTone {
  return TONES[index % TONES.length]
}

/** 墙高只跟数量走（与网页一致，单位按 CSS px 用） */
export function wallHeightForCount(count: number): number {
  if (count <= 0) return 140
  if (count <= 5) return 260
  if (count <= 10) return 320
  if (count <= 15) return 380
  if (count <= 20) return 440
  return Math.min(300 + count * 10, 520)
}

type WallSpot = { x: number; y: number }

export function findPinSpot(existing: WallSpot[]): { x: number; y: number; rotate: number } {
  const rotate = Math.round((Math.random() * 12 - 6) * 10) / 10
  if (existing.length === 0) {
    return { x: 18 + Math.random() * 64, y: 12 + Math.random() * 28, rotate }
  }

  const minComfort = 14
  let best = { x: 50, y: 30, rotate }
  let bestScore = -1

  for (let i = 0; i < 60; i++) {
    const x = clamp(8 + Math.random() * 84, 8, 92)
    const y = clamp(6 + Math.random() * 58, 6, 72)
    let minDist = Infinity
    for (const note of existing) {
      minDist = Math.min(
        minDist,
        Math.hypot((note.x - x) * 1.05, (note.y - y) * 1.35),
      )
    }
    if (minDist < minComfort) continue
    const score = 24 - Math.abs(minDist - 18)
    if (score > bestScore) {
      bestScore = score
      best = { x, y, rotate }
    }
  }
  return best
}

export function normalizeNotes(list: StickyNote[]): StickyNote[] {
  return list.map((n, index) => ({
    ...n,
    id: n.id || `note-${index}`,
    text: (n.text || '').trim() || (n.src ? '照片' : '未命名'),
    detail: (n.detail || '').trim(),
    src: (n.src || '').trim(),
    x: clamp(Number(n.x) || 10, 4, 96),
    y: clamp(Number(n.y) || 10, 2, 80),
    rotate: Number.isFinite(Number(n.rotate)) ? Number(n.rotate) : 0,
    tone: TONES.includes(n.tone) ? n.tone : 'butter',
    kind: n.kind === 'photo' || n.src ? 'photo' : 'text',
  }))
}
