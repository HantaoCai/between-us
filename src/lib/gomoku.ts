import type { NoteAbout } from './notes'

export const GOMOKU_SIZE = 15

export type Stone = 'black' | 'white'

export type GomokuBoard = (Stone | null)[]

export function emptyGomokuBoard(): GomokuBoard {
  return Array.from({ length: GOMOKU_SIZE * GOMOKU_SIZE }, () => null)
}

export function gomokuIndex(row: number, col: number): number {
  return row * GOMOKU_SIZE + col
}

/** 15 路标准星位（0-based）：四角、边心、天元 */
export const GOMOKU_STARS: ReadonlyArray<readonly [number, number]> = [
  [3, 3],
  [3, 7],
  [3, 11],
  [7, 3],
  [7, 7],
  [7, 11],
  [11, 3],
  [11, 7],
  [11, 11],
]

const STAR_SET = new Set(GOMOKU_STARS.map(([r, c]) => gomokuIndex(r, c)))

export function isGomokuStar(index: number): boolean {
  return STAR_SET.has(index)
}

export function gomokuRowCol(index: number): { row: number; col: number } {
  return { row: Math.floor(index / GOMOKU_SIZE), col: index % GOMOKU_SIZE }
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < GOMOKU_SIZE && col >= 0 && col < GOMOKU_SIZE
}

export function stoneForPlayer(black: NoteAbout, who: NoteAbout): Stone {
  return who === black ? 'black' : 'white'
}

export function otherStone(stone: Stone): Stone {
  return stone === 'black' ? 'white' : 'black'
}

function getCell(board: GomokuBoard, row: number, col: number): Stone | null {
  if (!inBounds(row, col)) return null
  return board[gomokuIndex(row, col)]
}

/** 在 (row,col) 落子后的连子数（含该点） */
function lineCount(
  board: GomokuBoard,
  row: number,
  col: number,
  dr: number,
  dc: number,
  stone: Stone,
): number {
  let n = 1
  for (let s = 1; s < GOMOKU_SIZE; s++) {
    const v = getCell(board, row + dr * s, col + dc * s)
    if (v !== stone) break
    n++
  }
  for (let s = 1; s < GOMOKU_SIZE; s++) {
    const v = getCell(board, row - dr * s, col - dc * s)
    if (v !== stone) break
    n++
  }
  return n
}

function withMove(board: GomokuBoard, row: number, col: number, stone: Stone): GomokuBoard {
  const next = board.slice()
  next[gomokuIndex(row, col)] = stone
  return next
}

/** 禁手开启时黑棋只能恰好五连取胜；否则五连及以上都算胜 */
export function checkWinAfterMove(
  board: GomokuBoard,
  row: number,
  col: number,
  stone: Stone,
  forbidden: boolean,
): boolean {
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const) {
    const n = lineCount(board, row, col, dr, dc, stone)
    if (stone === 'black' && forbidden) {
      if (n === 5) return true
    } else if (n >= 5) {
      return true
    }
  }
  return false
}

/** 以落子为中心的 9 格线段，边界外或对方子记为 O，空为 .，己方为 X */
function lineChars(
  board: GomokuBoard,
  row: number,
  col: number,
  dr: number,
  dc: number,
  stone: Stone,
): string {
  const opp = otherStone(stone)
  let s = ''
  for (let i = -4; i <= 4; i++) {
    const r = row + dr * i
    const c = col + dc * i
    if (i === 0) {
      s += 'X'
      continue
    }
    if (!inBounds(r, c)) {
      s += 'O'
      continue
    }
    const cell = board[gomokuIndex(r, c)]
    if (cell === opp) s += 'O'
    else if (cell === stone) s += 'X'
    else s += '.'
  }
  return s
}

/**
 * 该方向是否形成四（活四/冲四）：含落子点的某个 5 格窗口里恰有 4 子 + 1 空。
 * 每个方向最多计 1，避免同一条「四」被多种子串重复匹配。
 */
function hasFourOnLine(line: string): boolean {
  // line 长度 9，中心下标 4
  for (let start = 0; start <= 4; start++) {
    if (start > 4 || start + 5 <= 4) continue
    const w = line.slice(start, start + 5)
    let x = 0
    let empty = 0
    let blocked = false
    for (const c of w) {
      if (c === 'X') x++
      else if (c === '.') empty++
      else blocked = true
    }
    if (!blocked && x === 4 && empty === 1) return true
  }
  return false
}

/**
 * 该方向是否形成活三（两端可延伸、一步能成活四）。
 * 已是「四」的方向不再计活三。
 */
function hasLiveThreeOnLine(line: string): boolean {
  if (hasFourOnLine(line)) return false
  const patterns = ['.XXX.', '.XX.X.', '.X.XX.']
  for (const p of patterns) {
    for (let start = 0; start <= line.length - p.length; start++) {
      if (line.slice(start, start + p.length) !== p) continue
      if (start <= 4 && 4 < start + p.length) return true
    }
  }
  return false
}

/** 黑棋禁手：长连、三三、四四（五连优先，胜棋不算禁手） */
export function isBlackForbidden(
  board: GomokuBoard,
  row: number,
  col: number,
  forbidden: boolean,
): boolean {
  if (!forbidden) return false
  if (getCell(board, row, col) != null) return true

  const next = withMove(board, row, col, 'black')
  if (checkWinAfterMove(next, row, col, 'black', true)) return false

  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const

  for (const [dr, dc] of dirs) {
    if (lineCount(next, row, col, dr, dc, 'black') > 5) return true
  }

  let threes = 0
  let fours = 0
  for (const [dr, dc] of dirs) {
    const line = lineChars(next, row, col, dr, dc, 'black')
    if (hasFourOnLine(line)) fours++
    else if (hasLiveThreeOnLine(line)) threes++
  }
  return threes >= 2 || fours >= 2
}

export function canPlace(
  board: GomokuBoard,
  row: number,
  col: number,
  stone: Stone,
  forbidden: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (!inBounds(row, col)) return { ok: false, reason: '超出棋盘' }
  if (getCell(board, row, col) != null) return { ok: false, reason: '这里已有棋子' }
  if (stone === 'black' && isBlackForbidden(board, row, col, forbidden)) {
    return { ok: false, reason: '禁手，不能落在这里' }
  }
  return { ok: true }
}

export function applyMove(
  board: GomokuBoard,
  row: number,
  col: number,
  stone: Stone,
): GomokuBoard {
  const next = board.slice()
  next[gomokuIndex(row, col)] = stone
  return next
}

export function boardFromFlat(cells: unknown): GomokuBoard | null {
  if (!Array.isArray(cells) || cells.length !== GOMOKU_SIZE * GOMOKU_SIZE) return null
  const next = emptyGomokuBoard()
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i]
    if (v !== null && v !== 'black' && v !== 'white') return null
    next[i] = v
  }
  return next
}

export type RunMarks = {
  /** 恰好三连的棋子下标 */
  three: ReadonlySet<number>
  /** 恰好四连的棋子下标（优先于三连样式） */
  four: ReadonlySet<number>
}

const EMPTY_RUNS: RunMarks = { three: new Set(), four: new Set() }

/**
 * 只标「对方」仍有威胁的三连 / 四连：
 * - 两端都被堵住（对方子或盘边）则不算风险，不标
 * - 至少一端为空才提示
 */
export function findRunMarks(board: GomokuBoard, threatStone: Stone): RunMarks {
  const three = new Set<number>()
  const four = new Set<number>()
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const

  for (const [dr, dc] of dirs) {
    const seen = new Set<number>()
    for (let row = 0; row < GOMOKU_SIZE; row++) {
      for (let col = 0; col < GOMOKU_SIZE; col++) {
        const start = gomokuIndex(row, col)
        if (seen.has(start)) continue
        const stone = board[start]
        if (stone !== threatStone) continue
        // 只从线段端点起步，避免重复
        const prev = getCell(board, row - dr, col - dc)
        if (prev === stone) continue

        const cells: number[] = [start]
        let r = row + dr
        let c = col + dc
        while (inBounds(r, c) && board[gomokuIndex(r, c)] === stone) {
          cells.push(gomokuIndex(r, c))
          r += dr
          c += dc
        }
        for (const i of cells) seen.add(i)

        if (cells.length !== 3 && cells.length !== 4) continue

        // 两端邻格：至少一侧为空才算还有威胁
        const endR = row + dr * (cells.length - 1)
        const endC = col + dc * (cells.length - 1)
        const headOpen = getCell(board, row - dr, col - dc) === null
        const tailOpen = getCell(board, endR + dr, endC + dc) === null
        if (!headOpen && !tailOpen) continue

        if (cells.length === 3) {
          for (const i of cells) three.add(i)
        } else {
          for (const i of cells) four.add(i)
        }
      }
    }
  }

  if (three.size === 0 && four.size === 0) return EMPTY_RUNS
  for (const i of four) three.delete(i)
  return { three, four }
}
