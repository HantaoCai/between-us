import rawNotes from '../data/notes.json'

export type NoteAbout = 'her' | 'me'
export type NoteTone = 'butter' | 'mint' | 'sky' | 'peach' | 'rose' | 'cream'
export type NoteKind = 'text' | 'photo'

export type StickyNote = {
  id: string
  kind: NoteKind
  text: string
  detail: string
  about: NoteAbout
  src: string
  x: number
  y: number
  rotate: number
  tone: NoteTone
}

export type WallSpot = { x: number; y: number }

const TONES: NoteTone[] = ['butter', 'mint', 'sky', 'peach', 'rose', 'cream']

function parseAbout(value: unknown): NoteAbout {
  return value === 'me' ? 'me' : 'her'
}

function parseTone(value: unknown): NoteTone {
  return TONES.includes(value as NoteTone) ? (value as NoteTone) : 'butter'
}

function parseKind(value: unknown, src: string): NoteKind {
  if (value === 'photo' || src) return 'photo'
  return 'text'
}

export function normalizeNotes(list: unknown): StickyNote[] {
  if (!Array.isArray(list)) return []
  return list.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>
    const src = String(row.src ?? '').trim()
    return {
      id: String(row.id ?? `note-${index}`),
      kind: parseKind(row.kind, src),
      text: String(row.text ?? '').trim() || (src ? '照片' : '未命名'),
      detail: String(row.detail ?? '').trim(),
      about: parseAbout(row.about),
      src,
      x: clamp(Number(row.x) || 10, 4, 96),
      y: clamp(Number(row.y) || 10, 2, 80),
      rotate: Number.isFinite(Number(row.rotate)) ? Number(row.rotate) : 0,
      tone: parseTone(row.tone),
    }
  })
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export const notes: StickyNote[] = normalizeNotes(rawNotes)

export function aboutLabel(about: NoteAbout): string {
  return about === 'me' ? '晗涛' : '佳佳'
}

export function nextTone(index: number): NoteTone {
  return TONES[index % TONES.length]
}

/** 墙高只跟数量走，不跟拖动位置走（避免往下拖墙一直长高） */
export function wallHeightForCount(count: number): number {
  if (count <= 0) return 140
  if (count <= 5) return 260
  if (count <= 10) return 320
  if (count <= 15) return 380
  if (count <= 20) return 440
  return Math.min(300 + count * 10, 520)
}

/** @deprecated */
export function wallHeightFromNotes(items: { y: number }[]): number {
  return wallHeightForCount(items.length)
}

/** @deprecated */
export function wallHeightPx(count: number): number {
  return wallHeightForCount(count)
}

/** 找一块空位：留出舒服间距，略带时间流（偏右/下一点） */
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
    // 间距够了即可，略偏好中等空隙，避免又挤又刻意散开到边角
    const score = 24 - Math.abs(minDist - 18)
    if (score > bestScore) {
      bestScore = score
      best = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rotate }
    }
  }

  if (bestScore < 0) {
    // 墙满了：扫网格找最空处
    for (let y = 6; y <= 52; y += 4) {
      for (let x = 4; x <= 74; x += 5) {
        let minDist = Infinity
        for (const note of existing) {
          minDist = Math.min(
            minDist,
            Math.hypot((note.x - x) * 1.05, (note.y - y) * 1.35),
          )
        }
        if (minDist > bestScore) {
          bestScore = minDist
          best = { x, y, rotate }
        }
      }
    }
  }

  return best
}
