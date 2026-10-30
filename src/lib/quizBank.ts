export type QuizCategory =
  | 'mix'
  | 'wen'
  | 'science'
  | 'life'
  | 'geo'
  | 'food'
  | 'fun'

export type QuizItem = {
  id: string
  cat: Exclude<QuizCategory, 'mix'>
  q: string
  options: [string, string, string, string]
  answer: 0 | 1 | 2 | 3
}

export const QUIZ_CATEGORIES: { id: QuizCategory; label: string }[] = [
  { id: 'mix', label: '综合' },
  { id: 'wen', label: '文史' },
  { id: 'science', label: '科普' },
  { id: 'life', label: '生活' },
  { id: 'geo', label: '地理' },
  { id: 'food', label: '美食' },
  { id: 'fun', label: '娱乐' },
]

export const QUIZ_ROUND_CHOICES = [6, 10, 14] as const

/** GitHub 题库（jsDelivr）；可用 VITE_QUIZ_BANK_BASE 覆盖 */
export const QUIZ_BANK_CDN =
  (import.meta.env.VITE_QUIZ_BANK_BASE as string | undefined)?.replace(/\/$/, '') ||
  'https://cdn.jsdelivr.net/gh/HantaoCai/between-us@main/public/quiz-bank'

/** 站点内同源题库（public/quiz-bank），CDN 失败或未推送时用 */
const LOCAL_BANK_BASE = `${import.meta.env.BASE_URL}quiz-bank`.replace(/\/$/, '')

type BankIndex = {
  version: number
  idCat?: Record<string, string>
  categories: Record<string, { file: string; count: number; ids: string[] }>
  all: { file: string; count: number; ids: string[] }
}

const poolCache = new Map<string, QuizItem[]>()
const idCache = new Map<string, string[]>()
let indexPromise: Promise<BankIndex | null> | null = null

/** 离线兜底（CDN/本地都失败时） */
const localFallback: QuizItem[] = [
  {
    id: 'fb1',
    cat: 'wen',
    q: '「床前明月光」的下一句是？',
    options: ['疑是地上霜', '低头思故乡', '举头望明月', '春风又绿江南岸'],
    answer: 0,
  },
  {
    id: 'fb2',
    cat: 'science',
    q: '水的化学式是？',
    options: ['CO₂', 'H₂O', 'O₂', 'NaCl'],
    answer: 1,
  },
  {
    id: 'fb3',
    cat: 'life',
    q: '防晒里的 SPF 主要对应防护？',
    options: ['UVA', 'UVB', '红外线', '蓝光'],
    answer: 1,
  },
  {
    id: 'fb4',
    cat: 'geo',
    q: '日本首都是？',
    options: ['大阪', '京都', '东京', '名古屋'],
    answer: 2,
  },
  {
    id: 'fb5',
    cat: 'food',
    q: '麻婆豆腐属于哪一菜系的代表菜之一？',
    options: ['鲁菜', '川菜', '粤菜', '淮扬菜'],
    answer: 1,
  },
  {
    id: 'fb6',
    cat: 'fun',
    q: '《千与千寻》的导演是？',
    options: ['新海诚', '宫崎骏', '细田守', '今敏'],
    answer: 1,
  },
]

function shuffleIds(ids: string[], seed: number): string[] {
  const nextIds = [...ids]
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  const next = () => {
    s = (s * 48271) % 2147483647
    return s
  }
  for (let i = nextIds.length - 1; i > 0; i--) {
    const j = next() % (i + 1)
    ;[nextIds[i], nextIds[j]] = [nextIds[j], nextIds[i]]
  }
  return nextIds
}

/** 从 id 池里算法抽 count 个（不放回） */
export function sampleIds(ids: string[], count: number, seed = Date.now()): string[] {
  if (ids.length === 0) return []
  const shuffled = shuffleIds(ids, seed)
  return shuffled.slice(0, Math.min(count, shuffled.length))
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`题库请求失败 ${res.status}`)
  return (await res.json()) as T
}

async function tryFetchJson<T>(paths: string[]): Promise<T | null> {
  for (const url of paths) {
    try {
      return await fetchJson<T>(url)
    } catch {
      /* try next */
    }
  }
  return null
}

function bankUrls(file: string): string[] {
  const remote = `${QUIZ_BANK_CDN}/${file}`
  const local = `${LOCAL_BANK_BASE}/${file}`
  // 开发优先同源，避免未推送时命中旧 CDN；线上优先 GitHub CDN
  return import.meta.env.DEV ? [local, remote] : [remote, local]
}

async function loadIndex(): Promise<BankIndex | null> {
  if (!indexPromise) {
    indexPromise = tryFetchJson<BankIndex>(bankUrls('index.json'))
  }
  return indexPromise
}

async function loadPoolFile(file: string, cacheKey: string): Promise<QuizItem[]> {
  const hit = poolCache.get(cacheKey)
  if (hit) return hit
  const data = await tryFetchJson<QuizItem[]>(bankUrls(file))
  if (!data?.length) return []
  poolCache.set(cacheKey, data)
  return data
}

async function idsForCategory(cat: QuizCategory): Promise<string[]> {
  const cached = idCache.get(cat)
  if (cached) return cached

  const index = await loadIndex()
  if (index) {
    const ids =
      cat === 'mix' ? index.all?.ids : index.categories?.[cat]?.ids
    if (ids?.length) {
      idCache.set(cat, ids)
      return ids
    }
  }

  // index 失败：拉题包再提取 id
  const file = cat === 'mix' ? 'all.json' : `${cat}.json`
  const pool = await loadPoolFile(file, cat)
  const ids = pool.map((q) => q.id)
  if (ids.length) idCache.set(cat, ids)
  return ids
}

async function itemsByIds(
  cat: QuizCategory,
  ids: string[],
  index: BankIndex | null,
): Promise<QuizItem[]> {
  if (cat !== 'mix') {
    const pool = await loadPoolFile(`${cat}.json`, cat)
    if (!pool.length) return []
    const map = new Map(pool.map((q) => [q.id, q]))
    return ids.map((id) => map.get(id)).filter((q): q is QuizItem => !!q)
  }

  // 综合：只拉抽中 id 涉及的分类文件，避免整包 all.json
  const catOf = index?.idCat
  const needed = new Set<string>()
  for (const id of ids) {
    const c = catOf?.[id]
    if (c) needed.add(c)
  }
  if (needed.size === 0) {
    const pool = await loadPoolFile('all.json', 'mix')
    const map = new Map(pool.map((q) => [q.id, q]))
    return ids.map((id) => map.get(id)).filter((q): q is QuizItem => !!q)
  }

  const map = new Map<string, QuizItem>()
  await Promise.all(
    [...needed].map(async (c) => {
      const pool = await loadPoolFile(`${c}.json`, c)
      for (const q of pool) map.set(q.id, q)
    }),
  )
  return ids.map((id) => map.get(id)).filter((q): q is QuizItem => !!q)
}

export function quizRoundOptions(_cat: QuizCategory = 'mix'): number[] {
  return [...QUIZ_ROUND_CHOICES]
}

export function categoryLabel(cat: QuizCategory): string {
  return QUIZ_CATEGORIES.find((c) => c.id === cat)?.label ?? '综合'
}

/**
 * 组成本局题目：
 * 1) 拉 index，算法筛出 count 个 id
 * 2) 再拉对应题包，按 id 取出
 * CDN 失败则试站点 /quiz-bank，再失败用内置兜底
 */
export async function buildQuizMatch(
  cat: QuizCategory,
  count: number,
): Promise<QuizItem[]> {
  const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0
  try {
    const index = await loadIndex()
    const ids = await idsForCategory(cat)
    if (ids.length > 0) {
      const picked = sampleIds(ids, count, seed)
      const items = await itemsByIds(cat, picked, index)
      if (items.length > 0) return items.slice(0, count)
    }
  } catch {
    /* fallback below */
  }

  // 直接拉题包再抽样
  try {
    const file = cat === 'mix' ? 'all.json' : `${cat}.json`
    const pool = await loadPoolFile(file, cat === 'mix' ? 'mix' : cat)
    if (pool.length) {
      const picked = sampleIds(
        pool.map((q) => q.id),
        count,
        seed + 7,
      )
      const map = new Map(pool.map((q) => [q.id, q]))
      return picked.map((id) => map.get(id)!).filter(Boolean).slice(0, count)
    }
  } catch {
    /* fallback below */
  }

  const fb = sampleIds(
    localFallback.map((q) => q.id),
    count,
    seed + 13,
  )
  const map = new Map(localFallback.map((q) => [q.id, q]))
  return fb.map((id) => map.get(id)!).filter(Boolean)
}

/** 大厅可预拉 index，缩短开局等待 */
export function prefetchQuizBankIndex(): void {
  void loadIndex()
}
