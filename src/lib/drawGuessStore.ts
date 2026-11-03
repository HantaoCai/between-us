import type { NoteAbout } from './notes'

export { canvasToJpeg } from './drawCanvas'

export type SavedDrawing = {
  id: string
  at: number
  word: string
  drawer: NoteAbout
  image: string
  ups: number
  downs: number
}

const KEY = 'between-us:draw-saves'
const MAX = 24

function readAll(): SavedDrawing[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is SavedDrawing =>
        !!row &&
        typeof row === 'object' &&
        typeof (row as SavedDrawing).id === 'string' &&
        typeof (row as SavedDrawing).image === 'string' &&
        typeof (row as SavedDrawing).word === 'string',
    )
  } catch {
    return []
  }
}

function writeAll(rows: SavedDrawing[]) {
  localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX)))
}

export function listSavedDrawings(): SavedDrawing[] {
  return readAll()
}

export function addSavedDrawing(
  row: Omit<SavedDrawing, 'id' | 'at'> & { id?: string; at?: number },
): SavedDrawing {
  const saved: SavedDrawing = {
    id: row.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: row.at ?? Date.now(),
    word: row.word,
    drawer: row.drawer,
    image: row.image,
    ups: row.ups,
    downs: row.downs,
  }
  const next = [saved, ...readAll().filter((r) => r.id !== saved.id)].slice(0, MAX)
  writeAll(next)
  return saved
}

export function removeSavedDrawing(id: string) {
  writeAll(readAll().filter((r) => r.id !== id))
}
