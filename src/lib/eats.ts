import seed from '../data/eats.json'

const STORAGE_KEY = 'between-us:eats-options'

export function normalizeEats(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const next: string[] = []
  for (const row of list) {
    const value = String(row ?? '')
      .trim()
      .slice(0, 24)
    if (!value || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

export const seedEats: string[] = normalizeEats(seed)

export function readLocalEats(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return normalizeEats(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writeLocalEats(options: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeEats(options)))
  } catch {
    /* ignore */
  }
}

/** 加权随机：转盘停在某一格 */
export function pickEatIndex(count: number): number {
  if (count <= 0) return 0
  return Math.floor(Math.random() * count)
}
