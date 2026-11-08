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

const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const

/**
 * 该方向是否形成四（活四/冲四）：含落子点的某个 5 格窗口里恰有 4 子 + 1 空。
 * 含「三空一」XXX.X / X.XXX、「二空二」XX.XX 等。
 */
function hasFourOnLine(line: string): boolean {
  // line 长度 9，中心下标 4；窗口必须盖住中心落子
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

/** 活四：两端可延伸的四连 .XXXX. */
function hasLiveFourOnLine(line: string): boolean {
  return line.includes('.XXXX.')
}

/**
 * 在空位落子后，该方向会不会出现活四。
 * 用于判定「活三」：存在一步能走成活四的点。
 */
function wouldLiveFourOnDir(
  board: GomokuBoard,
  row: number,
  col: number,
  dr: number,
  dc: number,
  stone: Stone,
): boolean {
  if (!inBounds(row, col)) return false
  if (getCell(board, row, col) != null) return false
  const next = withMove(board, row, col, stone)
  return hasLiveFourOnLine(lineChars(next, row, col, dr, dc, stone))
}

/**
 * 落子后该方向是否形成活三：线上存在空位，补上后能在同一方向成活四。
 * 比单纯匹配 .XXX. / .XX.X. 更稳，能盖住「连三 + 跳三」等组合。
 */
function hasLiveThreeOnDir(
  board: GomokuBoard,
  row: number,
  col: number,
  dr: number,
  dc: number,
  stone: Stone,
): boolean {
  const line = lineChars(board, row, col, dr, dc, stone)
  if (hasFourOnLine(line)) return false

  for (let i = -4; i <= 4; i++) {
    if (i === 0) continue
    const r = row + dr * i
    const c = col + dc * i
    if (!inBounds(r, c)) continue
    if (getCell(board, r, c) != null) continue
    if (wouldLiveFourOnDir(board, r, c, dr, dc, stone)) return true
  }
  return false
}

/** 黑棋禁手类型：长连、三三、四四（五连优先，胜棋不算禁手） */
export type BlackForbiddenKind = 'long' | 'double-three' | 'double-four'

function blackForbiddenReason(kind: BlackForbiddenKind): string {
  switch (kind) {
    case 'long':
      return '长连禁手：会连成六子及以上'
    case 'double-three':
      return '三三禁手：会同时形成两个活三'
    case 'double-four':
      return '四四禁手：会同时形成两个四'
  }
}

/**
 * 若该点对黑棋构成禁手，返回具体类型；否则 null。
 * 同时触犯多种时优先：长连 > 四四 > 三三。
 */
export function getBlackForbiddenKind(
  board: GomokuBoard,
  row: number,
  col: number,
  forbidden: boolean,
): BlackForbiddenKind | null {
  if (!forbidden) return null
  if (getCell(board, row, col) != null) return null

  const next = withMove(board, row, col, 'black')
  if (checkWinAfterMove(next, row, col, 'black', true)) return null

  for (const [dr, dc] of DIRS) {
    if (lineCount(next, row, col, dr, dc, 'black') > 5) return 'long'
  }

  let threes = 0
  let fours = 0
  for (const [dr, dc] of DIRS) {
    const line = lineChars(next, row, col, dr, dc, 'black')
    if (hasFourOnLine(line)) fours++
    else if (hasLiveThreeOnDir(next, row, col, dr, dc, 'black')) threes++
  }
  if (fours >= 2) return 'double-four'
  if (threes >= 2) return 'double-three'
  return null
}

export function isBlackForbidden(
  board: GomokuBoard,
  row: number,
  col: number,
  forbidden: boolean,
): boolean {
  return getBlackForbiddenKind(board, row, col, forbidden) != null
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
  if (stone === 'black') {
    const kind = getBlackForbiddenKind(board, row, col, forbidden)
    if (kind) return { ok: false, reason: blackForbiddenReason(kind) }
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
 * 禁手模式下：黑方在空位落子是否无法构成真实四连威胁（长连等禁手）。
 * 五连优先，能胜则不算禁手，仍应标红。
 */
function blackThreatEmptyDead(
  board: GomokuBoard,
  row: number,
  col: number,
): boolean {
  return inBounds(row, col) && isBlackForbidden(board, row, col, true)
}

/**
 * 只标「对方」仍有威胁的三连 / 四连：
 * - 连续三/四：至少一端为空才标
 * - 「二空一」跳三：任意 4 格窗口恰 3 子 + 1 空（XX.X / X.XX），把这三子标黄
 * - 「三空一」等冲四：任意 5 格窗口恰 4 子 + 1 空，把这四子标红
 * - 禁手模式且对方为黑：空位若是长连等禁手（黑不能下），不标
 */
export function findRunMarks(
  board: GomokuBoard,
  threatStone: Stone,
  forbidden = false,
): RunMarks {
  const three = new Set<number>()
  const four = new Set<number>()
  const filterBlackDead = forbidden && threatStone === 'black'

  for (const [dr, dc] of DIRS) {
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

        // 两端邻格：至少一侧在棋盘内为空才算还有威胁（界外不算开口）
        const endR = row + dr * (cells.length - 1)
        const endC = col + dc * (cells.length - 1)
        const headR = row - dr
        const headC = col - dc
        const tailR = endR + dr
        const tailC = endC + dc
        const headOpen = inBounds(headR, headC) && getCell(board, headR, headC) === null
        const tailOpen = inBounds(tailR, tailC) && getCell(board, tailR, tailC) === null
        if (!headOpen && !tailOpen) continue

        if (cells.length === 3) {
          for (const i of cells) three.add(i)
        } else if (filterBlackDead) {
          // 两端延伸点若全是长连等禁手，黑不能补四，白方无需红标
          const headThreat = headOpen && !blackThreatEmptyDead(board, headR, headC)
          const tailThreat = tailOpen && !blackThreatEmptyDead(board, tailR, tailC)
          if (!headThreat && !tailThreat) continue
          for (const i of cells) four.add(i)
        } else {
          for (const i of cells) four.add(i)
        }
      }
    }

    // 跳三（含 XX.X、X.XX）：4 窗恰 3 子 + 1 空；窗外至少一端开口才有威胁
    for (let row = 0; row < GOMOKU_SIZE; row++) {
      for (let col = 0; col < GOMOKU_SIZE; col++) {
        const cells: number[] = []
        let empty = 0
        let emptyR = -1
        let emptyC = -1
        let blocked = false
        for (let k = 0; k < 4; k++) {
          const r = row + dr * k
          const c = col + dc * k
          if (!inBounds(r, c)) {
            blocked = true
            break
          }
          const v = board[gomokuIndex(r, c)]
          if (v === threatStone) cells.push(gomokuIndex(r, c))
          else if (v == null) {
            empty++
            emptyR = r
            emptyC = c
          } else {
            blocked = true
            break
          }
        }
        if (blocked || cells.length !== 3 || empty !== 1) continue
        const headR = row - dr
        const headC = col - dc
        const tailR = row + dr * 4
        const tailC = col + dc * 4
        const headOpen = inBounds(headR, headC) && getCell(board, headR, headC) === null
        const tailOpen = inBounds(tailR, tailC) && getCell(board, tailR, tailC) === null
        if (!headOpen && !tailOpen) continue
        // 空位落黑会长连等禁手 → 黑不能补，取消黄标
        if (filterBlackDead && blackThreatEmptyDead(board, emptyR, emptyC)) continue
        for (const i of cells) three.add(i)
      }
    }

    // 冲四 / 活四（含 XXX.X、X.XXX、XX.XX）：5 窗恰 4 子 + 1 空
    for (let row = 0; row < GOMOKU_SIZE; row++) {
      for (let col = 0; col < GOMOKU_SIZE; col++) {
        const cells: number[] = []
        let empty = 0
        let emptyR = -1
        let emptyC = -1
        let blocked = false
        for (let k = 0; k < 5; k++) {
          const r = row + dr * k
          const c = col + dc * k
          if (!inBounds(r, c)) {
            blocked = true
            break
          }
          const v = board[gomokuIndex(r, c)]
          if (v === threatStone) cells.push(gomokuIndex(r, c))
          else if (v == null) {
            empty++
            emptyR = r
            emptyC = c
          } else {
            blocked = true
            break
          }
        }
        if (blocked || cells.length !== 4 || empty !== 1) continue
        // 4空1：空位落黑会长连等禁手 → 黑不能下，取消红标
        if (filterBlackDead && blackThreatEmptyDead(board, emptyR, emptyC)) continue
        for (const i of cells) four.add(i)
      }
    }
  }

  if (three.size === 0 && four.size === 0) return EMPTY_RUNS
  for (const i of four) three.delete(i)
  return { three, four }
}
