export type DistractMath = {
  kind: 'math'
  id: string
  prompt: string
  answer: string
}

export type DistractTongue = {
  kind: 'tongue'
  id: string
  prompt: string
  /** 需要完整打出的绕口令 */
  answer: string
}

export type DistractTask = DistractMath | DistractTongue

const MATH_POOL: Array<{ prompt: string; answer: string }> = [
  { prompt: '17 + 28 = ?', answer: '45' },
  { prompt: '9 × 8 = ?', answer: '72' },
  { prompt: '100 − 37 = ?', answer: '63' },
  { prompt: '6 × 7 + 5 = ?', answer: '47' },
  { prompt: '81 ÷ 9 = ?', answer: '9' },
  { prompt: '14 + 19 − 8 = ?', answer: '25' },
  { prompt: '12 × 4 = ?', answer: '48' },
  { prompt: '55 − 18 = ?', answer: '37' },
  { prompt: '3 × 15 = ?', answer: '45' },
  { prompt: '72 ÷ 8 = ?', answer: '9' },
]

const TONGUE_POOL = [
  '吃葡萄不吐葡萄皮',
  '红凤凰粉凤凰',
  '四是四十是十',
  '黑化肥发灰会挥发',
  '牛郎恋刘娘',
  '扁担长板凳宽',
]

function shuffle<T>(list: T[]): T[] {
  const next = [...list]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function nid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/** 默认 3 道算数 + 2 条绕口令，打乱顺序 */
export function buildDistractTasks(
  mathCount = 3,
  tongueCount = 2,
): DistractTask[] {
  const maths = shuffle(MATH_POOL)
    .slice(0, mathCount)
    .map(
      (row): DistractMath => ({
        kind: 'math',
        id: nid(),
        prompt: row.prompt,
        answer: row.answer,
      }),
    )
  const tongues = shuffle(TONGUE_POOL)
    .slice(0, tongueCount)
    .map(
      (line): DistractTongue => ({
        kind: 'tongue',
        id: nid(),
        prompt: `请完整打出：${line}`,
        answer: line,
      }),
    )
  return shuffle([...maths, ...tongues])
}

export function checkDistractAnswer(task: DistractTask, raw: string) {
  const got = raw.trim().replace(/\s+/g, '')
  const want = task.answer.trim().replace(/\s+/g, '')
  if (task.kind === 'math') return got === want
  return got === want
}
