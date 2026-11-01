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
import { chooseGomokuMove, cloneBoard } from './gomokuAi'
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

  function scheduleBotMove() {
    if (destroyed || !state || state.winner) return
    if (state.turn !== botWho) return
    if (thinking) return
    thinking = true
    const token = ++moveToken
    const snapSeq = state.seq
    const delay = 450 + Math.floor(Math.random() * 450)

    window.setTimeout(() => {
      void (async () => {
        try {
          if (destroyed || !state || token !== moveToken) return
          if (state.seq !== snapSeq || state.turn !== botWho || state.winner) return
          const stone = stoneForPlayer(state.black, botWho)
          const { index, source } = await chooseGomokuMove(
            state.board,
            stone,
            state.forbidden,
          )
          if (destroyed || !state || token !== moveToken) return
          if (state.seq !== snapSeq || state.turn !== botWho || state.winner) return
          if (!applyLocalMove(index, botWho)) return
          peerLog('人机落子', { index, source })
          reply({
            type: 'move',
            seq: state.seq,
            index,
            by: botWho,
          })
        } catch (e) {
          peerLog('人机落子失败', e instanceof Error ? e.message : e)
        } finally {
          if (token === moveToken) thinking = false
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
      state = freshState(msg.black, msg.forbidden, msg.seq)
      scheduleBotMove()
      return
    }
    if (msg.type === 'rematch') {
      if (!isAbout(msg.black) || typeof msg.seq !== 'number') return
      state = freshState(msg.black, state?.forbidden ?? true, msg.seq)
      thinking = false
      moveToken += 1
      scheduleBotMove()
      return
    }
    if (msg.type === 'sync') {
      if (typeof msg.seq !== 'number' || !Array.isArray(msg.cells)) return
      if (!isAbout(msg.turn) || !isAbout(msg.black)) return
      if (typeof msg.forbidden !== 'boolean') return
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
      applyLocalMove(msg.index, msg.by)
      scheduleBotMove()
      return
    }
    if (msg.type === 'undo-ask') {
      if (!state) return
      if (typeof msg.seq !== 'number' || msg.seq !== state.seq) return
      if (typeof msg.index !== 'number') return
      // 人机默认同意悔棋
      if (state.last === msg.index && state.moves.length > 0) {
        const idx = state.moves.pop()!
        state.board[idx] = null
        state.last = state.moves.length ? state.moves[state.moves.length - 1]! : null
        state.winner = null
        state.turn = isAbout(msg.by) ? msg.by : playerWho
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
      state.winner = otherAbout(msg.by)
      return
    }
  }

  return {
    onFromPlayer,
    destroy() {
      destroyed = true
      thinking = false
      moveToken += 1
      replyFn = null
      state = null
    },
  }
}
