import seed from '../data/wishlist.json'

export type WishlistItem = {
  id: string
  title: string
  note: string
  done: boolean
  createdAt: string
  doneAt?: string
}

function today(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function normalizeWishlist(list: unknown): WishlistItem[] {
  if (!Array.isArray(list)) return []
  const next: WishlistItem[] = []
  list.forEach((row, index) => {
    const item = (row ?? {}) as Record<string, unknown>
    const title = String(item.title ?? '').trim()
    if (!title) return
    const done = Boolean(item.done)
    const normalized: WishlistItem = {
      id: String(item.id ?? `wish-${index}`).slice(0, 64),
      title: title.slice(0, 80),
      note: String(item.note ?? '').trim().slice(0, 200),
      done,
      createdAt: String(item.createdAt ?? today()).slice(0, 32),
    }
    if (done) {
      normalized.doneAt = String(
        item.doneAt ?? item.createdAt ?? today(),
      ).slice(0, 32)
    }
    next.push(normalized)
  })
  return next
}

export const seedWishlist: WishlistItem[] = normalizeWishlist(seed)

export function newWishlistId(): string {
  return `wish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function createWishlistItem(title: string, note = ''): WishlistItem {
  return {
    id: newWishlistId(),
    title: title.trim().slice(0, 80),
    note: note.trim().slice(0, 200),
    done: false,
    createdAt: today(),
  }
}

export function toggleWishlistDone(item: WishlistItem): WishlistItem {
  if (item.done) {
    return { ...item, done: false, doneAt: undefined }
  }
  return { ...item, done: true, doneAt: today() }
}
