import type { NoteAbout } from './notes'
import { otherAbout } from './notes'
import {
  applyMove,
  canPlace,
  checkWinAfterMove,
  emptyGomokuBoard,
  gomokuRowCol,
  stoneForPlayer,
  type GomokuBoard,
} from './gomoku'
import { chooseGomokuMove, cloneBoard, pickHeuristicMove } from './gomokuAi'
import type { BotDriver, BotReply } from './botRoomSession'
import { peerLog } from './peerLog'

type BotState = {
  seq: number
  board: GomokuBoard
  turn: NoteAbout
  black: NoteAbout
  forbidden: boolean
  winner: NoteAbout | null
  moves: number[]
  last: number | null
}

/** Jev 超过此时长则中止，改走本地启发式，避免 thinking 永久卡住 */
const JEV_TIMEOUT_MS = 4000
const MAX_MOVE_ATTEMPTS = 4

function freshState(black: NoteAbout, forbidden: boolean, seq: number): BotState {
  return {
    seq,
    board: emptyGomokuBoard(),
    turn: black,
    black,
    forbidden,
    winner: null,
    moves: [],
    last: null,
  }
}

function isAbout(v: unknown): v is NoteAbout {
  return v === 'her' || v === 'me'
}

export function createGomokuBotDriver(opts: {
  botWho: NoteAbout
  playerWho: NoteAbout
}): BotDriver {
  const botWho = opts.botWho
  const playerWho = opts.playerWho
  let state: BotState | null = null
  let thinking = false
  let destroyed = false
  let moveToken = 0
  let replyFn: BotReply | null = null

  function reply(data: unknown) {
    if (destroyed || !replyFn) return
    replyFn(data)
  }

  function applyLocalMove(index: number, by: NoteAbout): boolean {
    if (!state || state.winner) return false
    if (state.turn !== by) return false
    const stone = stoneForPlayer(state.black, by)
    const { row, col } = gomokuRowCol(index)
    if (!canPlace(state.board, row, col, stone, state.forbidden).ok) return false
    state.board = applyMove(state.board, row, col, stone)
    state.last = index
    state.moves.push(index)
    if (checkWinAfterMove(state.board, row, col, stone, state.forbidden)) {
      state.winner = by
      return true
    }
    state.turn = otherAbout(by)
    return true
  }

  /** 盘面变更 / 重开时作废进行中的思考，防止 thinking 挡住下一手 */
  function cancelThinking() {
    thinking = false
    moveToken += 1
  }

  function scheduleBotMove(attempt = 0) {
    if (destroyed || !state || state.winner) return
    if (state.turn !== botWho) return
    if (thinking) return
    thinking = true
    const token = ++moveToken
    const snapSeq = state.seq
    const delay =
      attempt === 0 ? 450 + Math.floor(Math.random() * 450) : 220 + attempt * 120

    window.setTimeout(() => {
      void (async () => {
        const ac = new AbortController()
        const kill = window.setTimeout(() => ac.abort(), JEV_TIMEOUT_MS)
        let shouldRetry = false
        try {
          if (destroyed || !state || token !== moveToken) return
          if (state.seq !== snapSeq || state.turn !== botWho || state.winner) return

          const stone = stoneForPlayer(state.black, botWho)
          let index: number
          let source: 'jev' | 'heuristic'
          try {
            const picked = await chooseGomokuMove(
              state.board,
              stone,
              state.forbidden,
              { signal: ac.signal },
            )
            index = picked.index
            source = picked.source
          } catch (e) {
            const fallback = pickHeuristicMove(state.board, stone, state.forbidden)
            if (fallback == null) {
              peerLog(
                '人机无可落子点',
                e instanceof Error ? e.message : e,
              )
              return
            }
            index = fallback
            source = 'heuristic'
            peerLog('人机选点降级启发式', e instanceof Error ? e.message : e)
          }

          if (destroyed || !state || token !== moveToken) return
          if (state.seq !== snapSeq || state.turn !== botWho || state.winner) return

          if (!applyLocalMove(index, botWho)) {
            peerLog('人机落子无效，将重试', { index, attempt })
            shouldRetry = attempt + 1 < MAX_MOVE_ATTEMPTS
            return
          }
          peerLog('人机落子', { index, source })
          reply({
            type: 'move',
            seq: state.seq,
            index,
            by: botWho,
          })
        } catch (e) {
          peerLog('人机落子失败', e instanceof Error ? e.message : e)
          shouldRetry = attempt + 1 < MAX_MOVE_ATTEMPTS
        } finally {
          window.clearTimeout(kill)
          if (token === moveToken) thinking = false
        }

        if (
          shouldRetry &&
          token === moveToken &&
          !destroyed &&
          state &&
          !state.winner &&
          state.turn === botWho &&
          state.seq === snapSeq
        ) {
          scheduleBotMove(attempt + 1)
        }
      })()
    }, delay)
  }

  function onFromPlayer(raw: unknown, replyToPlayer: BotReply) {
    if (destroyed) return
    replyFn = replyToPlayer
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return
    const msg = raw as { type: string; [k: string]: unknown }

    if (msg.type === 'hello') {
      reply({ type: 'hello', who: botWho })
      reply({ type: 'ready' })
      return
    }
    if (msg.type === 'ready' || msg.type === 'hub-return' || msg.type === 'hub-pick') {
      return
    }
    if (msg.type === 'need-sync') {
      if (state && state.seq > 0) {
        reply({
          type: 'sync',
          seq: state.seq,
          cells: state.board.slice(),
          turn: state.turn,
          black: state.black,
          forbidden: state.forbidden,
          winner: state.winner,
          endReason: state.winner ? 'five' : null,
          last: state.last,
          moves: state.moves.slice(),
          undo: null,
        })
      } else {
        reply({ type: 'need-start' })
      }
      return
    }
    if (msg.type === 'start') {
      if (!isAbout(msg.black) || typeof msg.forbidden !== 'boolean') return
      if (typeof msg.seq !== 'number') return
      cancelThinking()
      state = freshState(msg.black, msg.forbidden, msg.seq)
      scheduleBotMove()
      return
    }
    if (msg.type === 'rematch') {
      if (!isAbout(msg.black) || typeof msg.seq !== 'number') return
      cancelThinking()
      state = freshState(msg.black, state?.forbidden ?? true, msg.seq)
      scheduleBotMove()
      return
    }
    if (msg.type === 'sync') {
      if (typeof msg.seq !== 'number' || !Array.isArray(msg.cells)) return
      if (!isAbout(msg.turn) || !isAbout(msg.black)) return
      if (typeof msg.forbidden !== 'boolean') return
      cancelThinking()
      state = {
        seq: msg.seq,
        board: cloneBoard(msg.cells as GomokuBoard),
        turn: msg.turn,
        black: msg.black,
        forbidden: msg.forbidden,
        winner: isAbout(msg.winner) ? msg.winner : null,
        moves: Array.isArray(msg.moves)
          ? (msg.moves as number[]).filter((n) => Number.isInteger(n))
          : [],
        last: typeof msg.last === 'number' ? msg.last : null,
      }
      scheduleBotMove()
      return
    }
    if (msg.type === 'move') {
      if (!state) return
      if (typeof msg.seq !== 'number' || msg.seq !== state.seq) return
      if (typeof msg.index !== 'number' || !isAbout(msg.by)) return
      if (msg.by === botWho) return
      // 玩家落子 / 权威 sync 可能与思考重叠：作废旧思考再排程
      cancelThinking()
      applyLocalMove(msg.index, msg.by)
      scheduleBotMove()
      return
    }
    if (msg.type === 'undo-ask') {
      if (!state) return
      if (typeof msg.seq !== 'number' || msg.seq !== state.seq) return
      if (typeof msg.index !== 'number') return
      // 终盘不可悔；对局中人机默认同意
      if (state.winner) {
        reply({ type: 'undo-no', seq: state.seq })
        return
      }
      if (state.last === msg.index && state.moves.length > 0) {
        const idx = state.moves.pop()!
        state.board[idx] = null
        state.last = state.moves.length ? state.moves[state.moves.length - 1]! : null
        state.winner = null
        state.turn = isAbout(msg.by) ? msg.by : playerWho
        cancelThinking()
        reply({ type: 'undo-ok', seq: state.seq, index: msg.index })
      } else {
        reply({ type: 'undo-no', seq: state.seq })
      }
      return
    }
    if (msg.type === 'undo-ok' || msg.type === 'undo-no') {
      return
    }
    if (msg.type === 'resign') {
      if (!state || !isAbout(msg.by)) return
      // 只能在认输方还能走子时生效
      if (state.winner || state.turn !== msg.by) return
      cancelThinking()
      state.winner = otherAbout(msg.by)
      return
    }
  }

  return {
    onFromPlayer,
    destroy() {
      destroyed = true
      cancelThinking()
      replyFn = null
      state = null
    },
  }
}
