import {
  applyMove,
  canPlace,
  checkWinAfterMove,
  emptyGomokuBoard,
  GOMOKU_SIZE,
  gomokuIndex,
  gomokuRowCol,
  inBounds,
  otherStone,
  type GomokuBoard,
  type Stone,
} from './gomoku'
import { isJevConfigured } from './jevConfig'
import { jevPickChoice } from './jevClient'

type Scored = { index: number; score: number; label: string }

function cellChar(board: GomokuBoard, index: number, me: Stone): string {
  const v = board[index]
  if (v == null) return '.'
  return v === me ? 'X' : 'O'
}

export function boardToText(board: GomokuBoard, me: Stone): string {
  const lines: string[] = []
  for (let r = 0; r < GOMOKU_SIZE; r++) {
    let row = ''
    for (let c = 0; c < GOMOKU_SIZE; c++) {
      row += cellChar(board, gomokuIndex(r, c), me)
    }
    lines.push(row)
  }
  return lines.join('\n')
}

function hasNeighbor(board: GomokuBoard, row: number, col: number): boolean {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) continue
      const r = row + dr
      const c = col + dc
      if (!inBounds(r, c)) continue
      if (board[gomokuIndex(r, c)] != null) return true
    }
  }
  return false
}

function listOpenIndexes(board: GomokuBoard, stone: Stone, forbidden: boolean): number[] {
  const occupied = board.some((c) => c != null)
  const out: number[] = []
  for (let i = 0; i < board.length; i++) {
    if (board[i] != null) continue
    const { row, col } = gomokuRowCol(i)
    if (occupied && !hasNeighbor(board, row, col)) continue
    if (!occupied && !(row === 7 && col === 7) && Math.abs(row - 7) + Math.abs(col - 7) > 2) {
      continue
    }
    const ok = canPlace(board, row, col, stone, forbidden)
    if (ok.ok) out.push(i)
  }
  if (out.length === 0) {
    for (let i = 0; i < board.length; i++) {
      if (board[i] != null) continue
      const { row, col } = gomokuRowCol(i)
      if (canPlace(board, row, col, stone, forbidden).ok) out.push(i)
    }
  }
  return out
}

function lineThreatScore(board: GomokuBoard, row: number, col: number, stone: Stone): number {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const
  let score = 0
  const next = applyMove(board, row, col, stone)
  for (const [dr, dc] of dirs) {
    let n = 1
    for (let s = 1; s < 5; s++) {
      if (next[gomokuIndex(row + dr * s, col + dc * s)] !== stone) break
      n++
    }
    for (let s = 1; s < 5; s++) {
      if (next[gomokuIndex(row - dr * s, col - dc * s)] !== stone) break
      n++
    }
    if (n >= 5) score += 100000
    else if (n === 4) score += 8000
    else if (n === 3) score += 400
    else if (n === 2) score += 20
  }
  // 越靠中越好一点
  score += 14 - (Math.abs(row - 7) + Math.abs(col - 7))
  return score
}

export function rankGomokuMoves(
  board: GomokuBoard,
  stone: Stone,
  forbidden: boolean,
): Scored[] {
  const open = listOpenIndexes(board, stone, forbidden)
  const opp = otherStone(stone)
  const scored: Scored[] = []

  for (const index of open) {
    const { row, col } = gomokuRowCol(index)
    let score = 0
    let label = `空位 (${row + 1},${col + 1})`

    const after = applyMove(board, row, col, stone)
    if (checkWinAfterMove(after, row, col, stone, forbidden)) {
      score = 1_000_000
      label = `可直接五连取胜 (${row + 1},${col + 1})`
    } else {
      // 若对方下这里能赢，必须挡
      const blockOk = canPlace(board, row, col, opp, forbidden)
      if (blockOk.ok) {
        const afterOpp = applyMove(board, row, col, opp)
        if (checkWinAfterMove(afterOpp, row, col, opp, forbidden)) {
          score = 500_000
          label = `必须挡住对方五连 (${row + 1},${col + 1})`
        }
      }
      if (score < 500_000) {
        score = lineThreatScore(board, row, col, stone)
        const oppThreat = lineThreatScore(board, row, col, opp) * 0.85
        score += oppThreat
        label = `攻防价值约 ${Math.round(score)} 的点 (${row + 1},${col + 1})`
      }
    }
    scored.push({ index, score, label })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored
}

export function pickHeuristicMove(
  board: GomokuBoard,
  stone: Stone,
  forbidden: boolean,
): number | null {
  const ranked = rankGomokuMoves(board, stone, forbidden)
  return ranked[0]?.index ?? null
}

/** 启发式出候选，有 Jev 时在前几名里选；失败则退回第一名 */
export async function chooseGomokuMove(
  board: GomokuBoard,
  stone: Stone,
  forbidden: boolean,
  opts?: { signal?: AbortSignal },
): Promise<{ index: number; source: 'jev' | 'heuristic' }> {
  const ranked = rankGomokuMoves(board, stone, forbidden)
  if (ranked.length === 0) {
    throw new Error('没有可落子点')
  }
  // 必胜 / 必挡不浪费 Jev
  if (ranked[0].score >= 500_000 || ranked.length === 1 || !isJevConfigured()) {
    return { index: ranked[0].index, source: 'heuristic' }
  }

  const top = ranked.slice(0, Math.min(10, ranked.length))
  const criteria: Record<string, string> = {}
  for (const m of top) {
    const { row, col } = gomokuRowCol(m.index)
    criteria[`r${row}c${col}`] = m.label
  }

  try {
    const { choice } = await jevPickChoice(
      {
        rules: forbidden
          ? '15路五子棋，黑棋有三三/四四/长连禁手；恰好五连胜'
          : '15路五子棋，先五连者胜，无禁手',
        bot_stone: stone === 'black' ? '黑' : '白',
        board_text: boardToText(board, stone),
        legend: 'X=机器人棋子，O=玩家棋子，.=空',
      },
      '下一步机器人应落在哪个候选点？只根据盘面攻防选一个。',
      criteria,
      { signal: opts?.signal },
    )
    const match = /^r(\d+)c(\d+)$/.exec(choice)
    if (match) {
      const row = Number(match[1])
      const col = Number(match[2])
      const index = gomokuIndex(row, col)
      if (top.some((t) => t.index === index)) {
        return { index, source: 'jev' }
      }
    }
  } catch {
    /* 降级启发式 */
  }
  return { index: ranked[0].index, source: 'heuristic' }
}

export function cloneBoard(cells: (Stone | null)[]): GomokuBoard {
  const next = emptyGomokuBoard()
  for (let i = 0; i < next.length && i < cells.length; i++) {
    const v = cells[i]
    next[i] = v === 'black' || v === 'white' ? v : null
  }
  return next
}
