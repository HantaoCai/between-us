import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnterRoomGate } from '../../components/EnterRoomGate'
import { GameShell } from '../../components/GameShell'
import { RoomBanner } from '../../components/PeerLobby'
import { SpectatorBanner } from '../../components/SpectatorBanner'
import {
  createBotRoomSession,
  isSoloRoomCode,
  SOLO_ROOM_CODE,
} from '../../lib/botRoomSession'
import { createGomokuBotDriver } from '../../lib/gomokuBot'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import {
  applyMove as placeStone,
  canPlace,
  checkWinAfterMove,
  emptyGomokuBoard,
  findRunMarks,
  GOMOKU_SIZE,
  GOMOKU_STARS,
  otherStone,
  stoneForPlayer,
  type GomokuBoard,
  type Stone,
} from '../../lib/gomoku'
import { leaveGameToHub } from '../../lib/hubNav'
import {
  applyPeerHelloIdentity,
  usePeerReenter,
  wrapGameHandlers,
} from '../../lib/gameSession'
import { usePeerRoom } from '../../lib/PeerRoomContext'
import {
  adoptParkedSession,
  clearPeerHandoff,
  releaseParkedRoom,
} from '../../lib/peerHandoff'
import {
  createPeerRoom,
  joinPeerRoom,
  type RoomHandlers,
  type RoomSession,
} from '../../lib/peerRoom'
import { usePeerSessionGuard } from '../../lib/usePeerSessionGuard'
import {
  clearPeerRoom,
  isSavedGomoku,
  peerRoomMeta,
  readPeerRoom,
  savePlayPeerRoom,
  useFlushPeerRoomOnLeave,
  type SavedGomoku,
} from '../../lib/peerRoomSave'
import { useGamePeerBoot } from '../../lib/useGamePeerBoot'

const RULE =
  '15×15 棋盘，先连成五子的一方胜。可选连珠禁手。自己下完可申请悔棋，需对方同意；可认输。对方三连、四连会高亮。'

type Phase = 'lobby' | 'wait' | 'play' | 'done'

type EndReason = 'five' | 'resign'

type SyncUndo = { by: NoteAbout; index: number }

type SyncMsg = {
  type: 'sync'
  seq: number
  cells: (Stone | null)[]
  turn: NoteAbout
  black: NoteAbout
  forbidden: boolean
  winner: NoteAbout | null
  endReason: EndReason | null
  last: number | null
  moves: number[]
  /** 重连后对齐悔棋弹窗；缺省当没有进行中的申请 */
  undo?: SyncUndo | null
}

type Msg =
  | { type: 'hello'; who: NoteAbout }
  | { type: 'ready' }
  | { type: 'need-start' }
  /** 房主刷新后本地无棋局，向对方要盘面 */
  | { type: 'need-sync' }
  | {
      type: 'start'
      seq: number
      black: NoteAbout
      forbidden: boolean
    }
  | { type: 'move'; seq: number; index: number; by: NoteAbout }
  | { type: 'undo-ask'; seq: number; index: number; by: NoteAbout }
  | { type: 'undo-ok'; seq: number; index: number }
  | { type: 'undo-no'; seq: number }
  | { type: 'resign'; seq: number; by: NoteAbout }
  | SyncMsg
  | { type: 'rematch'; seq: number; black: NoteAbout }

type UndoAsk = 'waiting' | 'decide'

function isAbout(value: unknown): value is NoteAbout {
  return value === 'her' || value === 'me'
}

function isSync(raw: Msg): raw is SyncMsg {
  if (raw.type !== 'sync') return false
  const msg = raw as SyncMsg
  if (!Number.isInteger(msg.seq) || msg.seq < 1) return false
  if (!isAbout(msg.turn) || !isAbout(msg.black)) return false
  if (typeof msg.forbidden !== 'boolean') return false
  if (msg.winner != null && !isAbout(msg.winner)) return false
  if (msg.endReason != null && msg.endReason !== 'five' && msg.endReason !== 'resign') {
    return false
  }
  if (msg.last != null && (!Number.isInteger(msg.last) || msg.last < 0)) return false
  const board = emptyGomokuBoard()
  if (!Array.isArray(msg.cells) || msg.cells.length !== board.length) return false
  if (!msg.cells.every((c) => c === null || c === 'black' || c === 'white')) return false
  if (!Array.isArray(msg.moves)) return false
  if (!msg.moves.every((i) => Number.isInteger(i) && i >= 0 && i < board.length)) return false
  if (msg.undo != null) {
    if (!isAbout(msg.undo.by)) return false
    if (!Number.isInteger(msg.undo.index) || msg.undo.index < 0 || msg.undo.index >= board.length) {
      return false
    }
  }
  return true
}

export function GomokuPage() {
  const navigate = useNavigate()
  const room = usePeerRoom()
  const spectating = !!room.isSpectator
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [code, setCode] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(true)
  const [peerReady, setPeerReady] = useState(false)
  const [board, setBoard] = useState<GomokuBoard>(() => emptyGomokuBoard())
  const [turn, setTurn] = useState<NoteAbout>('her')
  const [blackPlayer, setBlackPlayer] = useState<NoteAbout>('her')
  const [winner, setWinner] = useState<NoteAbout | null>(null)
  const [endReason, setEndReason] = useState<EndReason | null>(null)
  const [lastMove, setLastMove] = useState<number | null>(null)
  const [moveCount, setMoveCount] = useState(0)
  const [moveHint, setMoveHint] = useState('')
  const [undoAsk, setUndoAsk] = useState<UndoAsk | null>(null)
  const [bootStatus, setBootStatus] = useState('')

  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  const peerWhoRef = useRef<NoteAbout | null>(null)
  const codeRef = useRef('')
  const isHostRef = useRef(false)
  const forbiddenRef = useRef(forbidden)
  const boardRef = useRef(board)
  const turnRef = useRef(turn)
  const blackRef = useRef(blackPlayer)
  const winnerRef = useRef<NoteAbout | null>(null)
  const endReasonRef = useRef<EndReason | null>(null)
  const lastRef = useRef<number | null>(null)
  const movesRef = useRef<number[]>([])
  const undoAskRef = useRef<UndoAsk | null>(null)
  const undoIndexRef = useRef<number | null>(null)
  const undoByRef = useRef<NoteAbout | null>(null)
  const seqRef = useRef(0)
  const firstBlackRef = useRef<NoteAbout>('her')
  const hintTimer = useRef(0)
  /** 落子发送中：防止手机端以为没落下又点别处 */
  const placeLockRef = useRef(false)
  /** 房主刷新后：等对方把未结束的棋局 sync 回来 */
  const [recovering, setRecovering] = useState(false)
  const recoveringRef = useRef(false)

  whoRef.current = who
  peerWhoRef.current = peerWho
  codeRef.current = code
  isHostRef.current = isHost
  forbiddenRef.current = forbidden
  boardRef.current = board
  turnRef.current = turn
  blackRef.current = blackPlayer
  winnerRef.current = winner
  endReasonRef.current = endReason
  lastRef.current = lastMove
  undoAskRef.current = undoAsk
  recoveringRef.current = recovering

  const leavingHubRef = useRef(false)
  const peerOpsRef = useRef({
    create: async (_code: string) => {},
    join: async (_code: string) => {},
  })

  function clearUndoAsk() {
    undoAskRef.current = null
    undoIndexRef.current = null
    undoByRef.current = null
    setUndoAsk(null)
  }

  function setUndoWaiting(index: number, by: NoteAbout) {
    undoIndexRef.current = index
    undoByRef.current = by
    undoAskRef.current = 'waiting'
    setUndoAsk('waiting')
  }

  function setUndoDecide(index: number, by: NoteAbout) {
    undoIndexRef.current = index
    undoByRef.current = by
    undoAskRef.current = 'decide'
    setUndoAsk('decide')
  }

  function sendUndoAsk() {
    const index = undoIndexRef.current
    const by = undoByRef.current
    if (index == null || !by) return
    sessionRef.current?.sendReliable({
      type: 'undo-ask',
      seq: seqRef.current,
      index,
      by,
    })
  }

  /** 断线重连后补发：对方可能没收到申请，或本方卡在「等同意」 */
  function reassertUndoAsk() {
    if (undoAskRef.current !== 'waiting') return
    sendUndoAsk()
  }

  function lastMoveBy(): NoteAbout | null {
    const index = lastRef.current
    if (index == null) return null
    const stone = boardRef.current[index]
    if (stone === 'black') return blackRef.current
    if (stone === 'white') return otherAbout(blackRef.current)
    return null
  }

  usePeerSessionGuard(sessionRef, () => true)
  useEffect(
    () => () => {
      window.clearTimeout(hintTimer.current)
    },
    [],
  )
  // 回合变化后解除落子锁（自己下完 turn 切走，或对方下完轮到自己）
  useEffect(() => {
    placeLockRef.current = false
  }, [turn, who, moveCount])

  function markRecovered() {
    recoveringRef.current = false
    setRecovering(false)
    setBusy(false)
    setBootStatus('')
  }

  /** 续局：一直停在「正在恢复」加载态，接到盘面再进对局，不闪重连页 */
  function stayRestoring(detail?: string) {
    recoveringRef.current = true
    setRecovering(true)
    setPhase('lobby')
    setBusy(true)
    setBootStatus(detail || '正在恢复棋局…')
  }

  function askPeerSync() {
    if (!sessionRef.current?.isHost) return
    if (seqRef.current > 0) return
    sessionRef.current.sendReliable({ type: 'need-sync' })
  }

  function buildGomokuSave(): SavedGomoku | null {
    if (seqRef.current < 1) return null
    return {
      seq: seqRef.current,
      cells: boardRef.current.slice(),
      turn: turnRef.current,
      black: blackRef.current,
      forbidden: forbiddenRef.current,
      winner: winnerRef.current,
      endReason: endReasonRef.current,
      last: lastRef.current,
      moves: movesRef.current.slice(),
      firstBlack: firstBlackRef.current,
    }
  }

  function persistGomokuRoom() {
    if (!codeRef.current) return
    const solo = isSoloRoomCode(codeRef.current)
    // 无进行中棋局时显式传 null，清掉旧终局档
    savePlayPeerRoom(
      {
        game: 'gomoku',
        code: codeRef.current,
        role: isHostRef.current ? 'host' : 'joiner',
        who: whoRef.current,
        mode: solo ? 'solo' : 'peer',
      },
      { gomoku: buildGomokuSave() },
    )
  }

  function restoreGomokuSave(saved: SavedGomoku) {
    seqRef.current = saved.seq
    boardRef.current = saved.cells.slice() as GomokuBoard
    setBoard(saved.cells.slice() as GomokuBoard)
    turnRef.current = saved.turn
    setTurn(saved.turn)
    blackRef.current = saved.black
    setBlackPlayer(saved.black)
    forbiddenRef.current = saved.forbidden
    setForbidden(saved.forbidden)
    winnerRef.current = saved.winner
    setWinner(saved.winner)
    endReasonRef.current = saved.endReason
    setEndReason(saved.endReason)
    lastRef.current = saved.last
    setLastMove(saved.last)
    movesRef.current = saved.moves.slice()
    setMoveCount(saved.moves.length)
    firstBlackRef.current = saved.firstBlack
    clearUndoAsk()
    placeLockRef.current = false
    setPhase(saved.winner ? 'done' : 'play')
    markRecovered()
  }

  function tryRestoreGomokuFromRoom(
    saved?: { gomoku?: SavedGomoku | null } | null,
  ): boolean {
    const raw = saved?.gomoku ?? readPeerRoom()?.gomoku
    if (!isSavedGomoku(raw)) return false
    restoreGomokuSave(raw)
    return true
  }

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!codeRef.current) return null
    const solo = isSoloRoomCode(codeRef.current)
    return {
      ...peerRoomMeta({
        game: 'gomoku',
        code: codeRef.current,
        role: isHostRef.current ? 'host' : 'joiner',
        who: whoRef.current,
        mode: solo ? 'solo' : 'peer',
      }),
      gomoku: buildGomokuSave(),
    }
  })

  const resumeSavedRef = useRef<{
    code: string
    role: 'host' | 'joiner'
    who: NoteAbout
    mode?: 'peer' | 'solo'
  } | null>(null)

  function failResume(message: string) {
    setBusy(false)
    setPhase('lobby')
    setBootStatus('')
    setError(message)
  }

  const {
    reenter,
    reset: resetReenter,
    reenterRef,
    isPending: isReenterPending,
  } = usePeerReenter({
    maxAttempts: 4,
    backoffMs: 500,
    leavingHubRef,
    getCode: () => codeRef.current || resumeSavedRef.current?.code || '',
    isHost: () =>
      (resumeSavedRef.current?.role ??
        (isHostRef.current ? 'host' : 'joiner')) === 'host',
    create: (code) => peerOpsRef.current.create(code),
    join: (code) => peerOpsRef.current.join(code),
    onRetry: (attempt, max) => {
      setBusy(true)
      setError('')
      setPhase('lobby')
      setBootStatus(`房间号释放中，稍后重试（${attempt}/${max}）…`)
    },
    onGiveUp: () =>
      failResume('房间号还没释放完，可点重新进房，或让对方也刷新'),
  })

  function bootSoloSession(playerWho: NoteAbout, resumeBoard = false) {
    clearPeerHandoff()
    room.destroySession()
    const botWho = otherAbout(playerWho)
    const driver = createGomokuBotDriver({ botWho, playerWho })
    const session = createBotRoomSession({
      code: SOLO_ROOM_CODE,
      driver,
    })
    whoRef.current = playerWho
    setWho(playerWho)
    peerWhoRef.current = botWho
    setPeerWho(botWho)
    room.setWho(playerWho)
    room.setPeerWho(botWho)
    if (resumeBoard) tryRestoreGomokuFromRoom()
    bindSession(session, true)
    setPeerReady(!!winnerRef.current || seqRef.current > 0)
    if (seqRef.current < 1) setPhase('wait')
    setBusy(false)
    setBootStatus('')
    setError('')
    persistGomokuRoom()
  }

  useGamePeerBoot(
    'gomoku',
    () => {
      adoptLiveFromProvider()
    },
    (saved) => {
      resumeSavedRef.current = {
        code: saved.code,
        role: saved.role,
        who: saved.who,
        mode: saved.mode,
      }
      whoRef.current = saved.who
      setWho(saved.who)
      tryRestoreGomokuFromRoom(saved)
      if (saved.mode === 'solo' || isSoloRoomCode(saved.code)) {
        setBusy(true)
        setBootStatus('正在进入人机…')
        bootSoloSession(saved.who, true)
        return
      }
      setBusy(true)
      setError('')
      setBootStatus('正在回到房间…')
      // 房主刷新内存丢了，连上后向对方要盘面
      if (saved.role === 'host') {
        const peer = otherAbout(saved.who)
        peerWhoRef.current = peer
        setPeerWho(peer)
        room.setPeerWho(peer)
        if (seqRef.current < 1) stayRestoring('正在恢复棋局…')
        void create(saved.code)
      } else {
        void join(saved.code)
      }
    },
  )

  function adoptLiveFromProvider() {
    const session = room.session
    if (!session) return
    room.bindHandlers(navHandlers(gomokuHandlers()))
    sessionRef.current = session
    whoRef.current = room.who
    setWho(room.who)
    isHostRef.current = room.isHost
    setIsHost(room.isHost)
    if (room.isHost) setPeerReady(false)
    codeRef.current = room.code
    setCode(room.code)
    if (room.peerWho) {
      peerWhoRef.current = room.peerWho
      setPeerWho(room.peerWho)
    }
    if (seqRef.current < 1) tryRestoreGomokuFromRoom()
    setPhase(seqRef.current > 0 ? (winnerRef.current ? 'done' : 'play') : 'wait')
    setBusy(false)
    setError('')
    if (session.conn?.open) onRoomOpen()
  }

  function buildSync(): SyncMsg {
    const undo =
      undoAskRef.current &&
      undoIndexRef.current != null &&
      undoByRef.current
        ? { by: undoByRef.current, index: undoIndexRef.current }
        : null
    return {
      type: 'sync',
      seq: seqRef.current,
      cells: boardRef.current.slice(),
      turn: turnRef.current,
      black: blackRef.current,
      forbidden: forbiddenRef.current,
      winner: winnerRef.current,
      endReason: endReasonRef.current,
      last: lastRef.current,
      moves: movesRef.current.slice(),
      undo,
    }
  }

  function resetBoardState(black: NoteAbout, useForbidden: boolean) {
    boardRef.current = emptyGomokuBoard()
    setBoard(emptyGomokuBoard())
    blackRef.current = black
    setBlackPlayer(black)
    forbiddenRef.current = useForbidden
    setForbidden(useForbidden)
    turnRef.current = black
    setTurn(black)
    winnerRef.current = null
    setWinner(null)
    endReasonRef.current = null
    setEndReason(null)
    lastRef.current = null
    setLastMove(null)
    movesRef.current = []
    setMoveCount(0)
    setMoveHint('')
    clearUndoAsk()
  }

  function startMatch(black: NoteAbout, useForbidden: boolean) {
    seqRef.current += 1
    resetBoardState(black, useForbidden)
    setPhase('play')
    persistGomokuRoom()
    sessionRef.current?.sendReliable({
      type: 'start',
      seq: seqRef.current,
      black,
      forbidden: useForbidden,
    })
    sessionRef.current?.sendReliable(buildSync())
  }

  function applySync(msg: SyncMsg) {
    if (msg.seq < seqRef.current) return
    if (msg.seq === seqRef.current) {
      const localMoves = movesRef.current
      const remoteMoves = msg.moves
      // 迟到的旧 sync 手数更少：绝不能盖掉本机刚落下、对面已收到的子
      if (remoteMoves.length < localMoves.length) return
      if (remoteMoves.length === localMoves.length) {
        const same = remoteMoves.every((m, i) => m === localMoves[i])
        if (same) {
          // 盘面一致，只对齐悔棋状态
          if (msg.undo && isAbout(msg.undo.by) && Number.isInteger(msg.undo.index)) {
            if (msg.undo.by === whoRef.current) setUndoWaiting(msg.undo.index, msg.undo.by)
            else setUndoDecide(msg.undo.index, msg.undo.by)
          } else if (undoAskRef.current !== 'waiting') {
            clearUndoAsk()
          }
          markRecovered()
          return
        }
        // 同手数但路径不同：房主保留本地；加入方跟房主
        if (sessionRef.current?.isHost) return
      }
    }
    const keptWaiting =
      undoAskRef.current === 'waiting' &&
      undoIndexRef.current != null &&
      undoByRef.current === whoRef.current
        ? { index: undoIndexRef.current, by: undoByRef.current }
        : null
    seqRef.current = msg.seq
    boardRef.current = msg.cells.slice()
    setBoard(msg.cells.slice())
    turnRef.current = msg.turn
    setTurn(msg.turn)
    blackRef.current = msg.black
    setBlackPlayer(msg.black)
    forbiddenRef.current = msg.forbidden
    setForbidden(msg.forbidden)
    winnerRef.current = msg.winner
    setWinner(msg.winner)
    endReasonRef.current = msg.endReason
    setEndReason(msg.endReason)
    lastRef.current = msg.last
    setLastMove(msg.last)
    movesRef.current = msg.moves.slice()
    setMoveCount(msg.moves.length)
    setPhase(msg.winner ? 'done' : 'play')
    placeLockRef.current = false
    if (msg.seq > 0) {
      firstBlackRef.current = msg.black
      markRecovered()
      resetReenter()
      persistGomokuRoom()
    }

    if (msg.undo && isAbout(msg.undo.by) && Number.isInteger(msg.undo.index)) {
      if (msg.undo.by === whoRef.current) setUndoWaiting(msg.undo.index, msg.undo.by)
      else setUndoDecide(msg.undo.index, msg.undo.by)
      return
    }

    // 房主同步里没有悔棋：若本方仍在等、且上一手还是自己的申请目标，保留并稍后补发
    if (
      keptWaiting &&
      msg.last === keptWaiting.index &&
      !msg.winner
    ) {
      const stone = msg.cells[keptWaiting.index]
      const byStone =
        stone === 'black'
          ? msg.black
          : stone === 'white'
            ? otherAbout(msg.black)
            : null
      if (byStone === keptWaiting.by) {
        setUndoWaiting(keptWaiting.index, keptWaiting.by)
        window.setTimeout(() => reassertUndoAsk(), 300)
        return
      }
    }
    clearUndoAsk()
  }

  function applyMove(index: number, by: NoteAbout): boolean {
    if (winnerRef.current) return false
    if (undoAskRef.current) return false
    // 重复包：同一手已落下则当作成功，避免 sendReliable 重放打乱
    if (
      movesRef.current.length > 0 &&
      movesRef.current[movesRef.current.length - 1] === index &&
      lastMoveBy() === by
    ) {
      return true
    }
    if (turnRef.current !== by) return false
    const row = Math.floor(index / GOMOKU_SIZE)
    const col = index % GOMOKU_SIZE
    const stone = stoneForPlayer(blackRef.current, by)
    const check = canPlace(boardRef.current, row, col, stone, forbiddenRef.current)
    if (!check.ok) {
      if (by === whoRef.current) {
        setMoveHint(check.reason)
        window.clearTimeout(hintTimer.current)
        hintTimer.current = window.setTimeout(() => setMoveHint(''), 1600)
      }
      return false
    }
    const next = placeStone(boardRef.current, row, col, stone)
    boardRef.current = next
    setBoard(next)
    lastRef.current = index
    setLastMove(index)
    movesRef.current = [...movesRef.current, index]
    setMoveCount(movesRef.current.length)
    setMoveHint('')
    clearUndoAsk()

    if (checkWinAfterMove(next, row, col, stone, forbiddenRef.current)) {
      winnerRef.current = by
      setWinner(by)
      endReasonRef.current = 'five'
      setEndReason('five')
      setPhase('done')
      placeLockRef.current = false
      persistGomokuRoom()
      return true
    }

    const nextTurn = otherAbout(by)
    turnRef.current = nextTurn
    setTurn(nextTurn)
    // 对方落子后轮到我：解锁；自己落子由 playAt 保持锁定，等 turn 更新
    if (by !== whoRef.current) placeLockRef.current = false
    persistGomokuRoom()
    return true
  }

  function applyUndo(index: number): boolean {
    const moves = movesRef.current
    if (moves.length === 0) return false
    const last = moves[moves.length - 1]
    if (last !== index) return false
    const stone = boardRef.current[index]
    if (stone !== 'black' && stone !== 'white') return false

    const next = boardRef.current.slice()
    next[index] = null
    boardRef.current = next
    setBoard(next)

    const rest = moves.slice(0, -1)
    movesRef.current = rest
    setMoveCount(rest.length)
    const prev = rest.length > 0 ? rest[rest.length - 1]! : null
    lastRef.current = prev
    setLastMove(prev)

    const by = stone === 'black' ? blackRef.current : otherAbout(blackRef.current)
    turnRef.current = by
    setTurn(by)
    winnerRef.current = null
    setWinner(null)
    endReasonRef.current = null
    setEndReason(null)
    setPhase('play')
    setMoveHint('')
    clearUndoAsk()
    persistGomokuRoom()
    return true
  }

  function applyResign(by: NoteAbout): boolean {
    // 只能在还能走子时认输（轮到认输方、无胜负、无悔棋待决）
    if (winnerRef.current) return false
    if (undoAskRef.current) return false
    if (turnRef.current !== by) return false
    const win = otherAbout(by)
    winnerRef.current = win
    setWinner(win)
    endReasonRef.current = 'resign'
    setEndReason('resign')
    setPhase('done')
    setMoveHint('')
    clearUndoAsk()
    persistGomokuRoom()
    return true
  }

  function hello() {
    sessionRef.current?.sendReliable({ type: 'hello', who: whoRef.current })
  }

  function onData(raw: unknown) {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return
    const msg = raw as Msg
    if (msg.type === 'hello') {
      if (!isAbout(msg.who)) return
      resetReenter()
      const isHostNow = !!sessionRef.current?.isHost
      applyPeerHelloIdentity({
        peerWho: msg.who,
        isHost: isHostNow,
        whoRef,
        setWho,
        setPeerWho: (w) => {
          peerWhoRef.current = w
          setPeerWho(w)
        },
        sendHello: isHostNow ? undefined : () => hello(),
      })
      if (!isHostNow) {
        if (seqRef.current > 0) {
          sessionRef.current?.sendReliable(buildSync())
        }
      } else {
        askPeerSync()
      }
      sessionRef.current?.sendReliable({ type: 'ready' })
      return
    }
    if (msg.type === 'ready') {
      if (sessionRef.current?.isHost) {
        setPeerReady(true)
        askPeerSync()
      }
      return
    }
    if (msg.type === 'need-start') {
      // 对方也没有进行中的棋局：结束恢复态，进入正常等人开局
      if (sessionRef.current?.isHost && seqRef.current === 0) {
        markRecovered()
        setPhase('wait')
      }
      return
    }
    if (msg.type === 'need-sync') {
      if (seqRef.current > 0) {
        sessionRef.current?.sendReliable(buildSync())
      } else if (!sessionRef.current?.isHost) {
        sessionRef.current?.sendReliable({ type: 'need-start' })
      }
      return
    }
    if (msg.type === 'start') {
      if (sessionRef.current?.isHost) return
      if (!Number.isInteger(msg.seq) || msg.seq <= seqRef.current) return
      if (!isAbout(msg.black)) return
      if (typeof msg.forbidden !== 'boolean') return
      seqRef.current = msg.seq
      resetBoardState(msg.black, msg.forbidden)
      setPhase('play')
      markRecovered()
      return
    }
    if (msg.type === 'sync') {
      if (!isSync(msg)) return
      // 房主平时是权威；刷新后本地 seq=0，必须接对方盘面才能续下
      if (sessionRef.current?.isHost) {
        if (seqRef.current > 0 && msg.seq <= seqRef.current) return
        if (msg.seq < 1) return
      }
      applySync(msg)
      return
    }
    if (msg.type === 'move') {
      if (!Number.isInteger(msg.seq) || msg.seq !== seqRef.current) return
      if (!Number.isInteger(msg.index)) return
      if (!isAbout(msg.by)) return
      // 对方落子 = 没回应悔棋（或申请在断线时丢了），取消卡死的申请
      if (undoAskRef.current) clearUndoAsk()
      const ok = applyMove(msg.index, msg.by)
      // 房主收到落子后广播权威盘面，避免加入方被旧 sync 盖掉后又乱点
      if (ok && sessionRef.current?.isHost) {
        sessionRef.current.sendReliable(buildSync())
      }
      return
    }
    if (msg.type === 'undo-ask') {
      if (winnerRef.current) return
      if (!Number.isInteger(msg.seq) || msg.seq !== seqRef.current) return
      if (!Number.isInteger(msg.index)) return
      if (!isAbout(msg.by) || msg.by === whoRef.current) return
      if (lastRef.current !== msg.index) return
      if (lastMoveBy() !== msg.by) return
      setUndoDecide(msg.index, msg.by)
      return
    }
    if (msg.type === 'undo-ok') {
      if (winnerRef.current) return
      if (!Number.isInteger(msg.seq) || msg.seq !== seqRef.current) return
      if (!Number.isInteger(msg.index)) return
      applyUndo(msg.index)
      return
    }
    if (msg.type === 'undo-no') {
      if (!Number.isInteger(msg.seq) || msg.seq !== seqRef.current) return
      // waiting→被拒；decide→对方取消了申请
      const wasWaiting = undoAskRef.current === 'waiting'
      clearUndoAsk()
      if (wasWaiting) {
        setMoveHint('对方不同意悔棋')
        window.clearTimeout(hintTimer.current)
        hintTimer.current = window.setTimeout(() => setMoveHint(''), 1800)
      }
      return
    }
    if (msg.type === 'resign') {
      if (!Number.isInteger(msg.seq) || msg.seq !== seqRef.current) return
      if (!isAbout(msg.by)) return
      applyResign(msg.by)
      return
    }
    if (msg.type === 'rematch') {
      if (sessionRef.current?.isHost) return
      if (!Number.isInteger(msg.seq) || !isAbout(msg.black)) return
      seqRef.current = msg.seq
      resetBoardState(msg.black, forbiddenRef.current)
      setPhase('play')
    }
  }

  function onRoomOpen() {
    setError('')
    resetReenter()
    hello()
    sessionRef.current?.sendReliable({ type: 'ready' })
    if (seqRef.current > 0) {
      sessionRef.current?.sendReliable(buildSync())
      // 对方刚连上时可能还没挂好监听，稍后再补发悔棋申请
      window.setTimeout(() => reassertUndoAsk(), 400)
      window.setTimeout(() => reassertUndoAsk(), 1200)
    } else if (sessionRef.current?.isHost) {
      askPeerSync()
      window.setTimeout(() => askPeerSync(), 200)
      window.setTimeout(() => askPeerSync(), 700)
    } else {
      sessionRef.current?.sendReliable({ type: 'need-start' })
    }
  }

  function gomokuHandlers(): RoomHandlers {
    return {
      onData,
      onOpen: onRoomOpen,
      onWake: () => {
        hello()
        // 对方切后台期间本方可能已多走了棋：双方都推/要盘，seq 更高的盘面生效
        if (seqRef.current > 0) {
          sessionRef.current?.sendReliable(buildSync())
          if (!sessionRef.current?.isHost) {
            sessionRef.current?.sendReliable({ type: 'need-sync' })
          }
          reassertUndoAsk()
          window.setTimeout(() => reassertUndoAsk(), 500)
        } else if (sessionRef.current?.isHost) {
          askPeerSync()
        } else {
          sessionRef.current?.sendReliable({ type: 'need-start' })
        }
      },
      onDisconnect: () => setError('对方暂时离开，你仍可操作；连上后会自动同步进度'),
      onPeerLost: () => reenter(),
      onClose: () => setError('对方断开了'),
    }
  }

  function navHandlers(handlers: RoomHandlers) {
    return wrapGameHandlers(handlers, {
      hereGame: 'gomoku',
      navigate,
      room,
      getMeta: () => ({
        code: codeRef.current || room.code,
        role: isHostRef.current ? 'host' : 'joiner',
        who: whoRef.current,
      }),
      onLocalLeave: () => {
        sessionRef.current = null
      },
    })
  }

  function bindSession(session: RoomSession, kickOpen: boolean) {
    sessionRef.current = session
    room.attachSession(session, { who: whoRef.current })
    room.bindHandlers(navHandlers(gomokuHandlers()))
    isHostRef.current = session.isHost
    setIsHost(session.isHost)
    codeRef.current = session.code
    setCode(session.code)
    resetReenter()
    if (seqRef.current > 0) {
      setPhase(winnerRef.current ? 'done' : 'play')
      markRecovered()
    } else if (recoveringRef.current) {
      stayRestoring('正在恢复棋局…')
      // 太久没接到盘面，再落到等人开局，避免永久转圈
      window.setTimeout(() => {
        if (!recoveringRef.current || seqRef.current > 0) return
        markRecovered()
        setPhase('wait')
      }, 12000)
    } else {
      setPhase('wait')
      setBusy(false)
      setBootStatus('')
    }
    persistGomokuRoom()
    if (kickOpen && session.conn?.open) onRoomOpen()
  }

  async function create(existingCode?: string) {
    setBusy(true)
    setError('')
    setBootStatus(existingCode ? '正在重新占房号…' : '正在开房…')
    try {
      const handlers = navHandlers(gomokuHandlers())
      if (existingCode) {
        setBootStatus('正在接回已有连接…')
        const live = await adoptParkedSession(existingCode, true, handlers)
        if (live) {
          bindSession(live, true)
          return
        }
      }
      sessionRef.current?.destroy()
      sessionRef.current = null
      if (existingCode) await releaseParkedRoom(existingCode)
      const session = await createPeerRoom(
        handlers,
        existingCode
          ? {
              code: existingCode,
              onAttempt: (n, total, busyId) => {
                setBootStatus(
                  busyId
                    ? `房号还在释放，重试占号（${n}/${total}）…`
                    : `正在占房号（${n}/${total}）…`,
                )
              },
            }
          : undefined,
      )
      bindSession(session, false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '开房失败'
      // 刷新后房号常要等信令释放；少次自动重试，失败就给出可点的重进
      if (
        !leavingHubRef.current &&
        (resumeSavedRef.current || existingCode) &&
        reenterRef.current < 4
      ) {
        setError(msg)
        reenter()
        return
      }
      failResume(msg)
    } finally {
      if (!isReenterPending() && !recoveringRef.current) {
        setBusy(false)
      }
    }
  }

  async function join(roomCode: string) {
    setBusy(true)
    setError('')
    setBootStatus('正在连对方…')
    try {
      const handlers = navHandlers(gomokuHandlers())
      const live = await adoptParkedSession(roomCode, false, handlers)
      if (live) {
        bindSession(live, true)
        return
      }
      sessionRef.current?.destroy()
      sessionRef.current = null
      await releaseParkedRoom(roomCode)
      const session = await joinPeerRoom(roomCode, handlers)
      bindSession(session, false)
      setBootStatus('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '加入失败'
      if (
        !leavingHubRef.current &&
        (resumeSavedRef.current || roomCode) &&
        reenterRef.current < 4
      ) {
        setError(msg)
        reenter()
        return
      }
      failResume(msg)
    } finally {
      if (!isReenterPending()) {
        setBusy(false)
      }
    }
  }

  peerOpsRef.current = { create, join }

  function retryResume() {
    const saved = resumeSavedRef.current
    if (!saved) return
    resetReenter()
    whoRef.current = saved.who
    setWho(saved.who)
    setBusy(true)
    setError('')
    setBootStatus('正在回到房间…')
    if (saved.role === 'host') {
      const peer = otherAbout(saved.who)
      peerWhoRef.current = peer
      setPeerWho(peer)
      room.setPeerWho(peer)
      stayRestoring('正在恢复棋局…')
      void create(saved.code)
    } else {
      void join(saved.code)
    }
  }

  function hostStart() {
    if (!sessionRef.current?.isHost || !peerWhoRef.current) return
    if (recoveringRef.current) return
    markRecovered()
    firstBlackRef.current = whoRef.current
    startMatch(whoRef.current, forbiddenRef.current)
  }

  function playAt(index: number) {
    if (spectating) return
    if (phase !== 'play' || winnerRef.current) return
    if (undoAskRef.current) return
    if (placeLockRef.current) return
    if (turnRef.current !== whoRef.current) return
    if (!sessionRef.current?.conn?.open) {
      setMoveHint('连接不稳，请再点一次')
      window.clearTimeout(hintTimer.current)
      hintTimer.current = window.setTimeout(() => setMoveHint(''), 1600)
      return
    }
    placeLockRef.current = true
    if (!applyMove(index, whoRef.current)) {
      placeLockRef.current = false
      return
    }
    sessionRef.current.sendReliable({
      type: 'move',
      seq: seqRef.current,
      index,
      by: whoRef.current,
    })
    // 只有房主推权威 sync；加入方只发 move，避免双方互推过期盘面
    if (sessionRef.current.isHost) {
      sessionRef.current.sendReliable(buildSync())
    }
  }

  function requestUndo() {
    if (winnerRef.current) return
    if (undoAskRef.current) return
    const index = lastRef.current
    if (index == null || movesRef.current.length === 0) return
    if (lastMoveBy() !== whoRef.current) return
    setUndoWaiting(index, whoRef.current)
    sendUndoAsk()
  }

  function cancelUndoAsk() {
    if (undoAskRef.current !== 'waiting') return
    clearUndoAsk()
    sessionRef.current?.sendReliable({
      type: 'undo-no',
      seq: seqRef.current,
    })
    if (sessionRef.current?.isHost) {
      sessionRef.current.sendReliable(buildSync())
    }
  }

  function acceptUndo() {
    if (undoAskRef.current !== 'decide') return
    const index = undoIndexRef.current
    if (index == null) return
    if (!applyUndo(index)) {
      clearUndoAsk()
      return
    }
    sessionRef.current?.sendReliable({
      type: 'undo-ok',
      seq: seqRef.current,
      index,
    })
    sessionRef.current?.sendReliable(buildSync())
  }

  function rejectUndo() {
    if (undoAskRef.current !== 'decide') return
    clearUndoAsk()
    sessionRef.current?.sendReliable({
      type: 'undo-no',
      seq: seqRef.current,
    })
    if (sessionRef.current?.isHost) {
      sessionRef.current.sendReliable(buildSync())
    }
  }

  function requestResign() {
    if (winnerRef.current || undoAskRef.current) return
    if (turnRef.current !== whoRef.current) return
    if (!applyResign(whoRef.current)) return
    sessionRef.current?.sendReliable({
      type: 'resign',
      seq: seqRef.current,
      by: whoRef.current,
    })
    sessionRef.current?.sendReliable(buildSync())
  }

  function rematch() {
    if (!sessionRef.current?.isHost) return
    const nextBlack = otherAbout(firstBlackRef.current)
    firstBlackRef.current = nextBlack
    seqRef.current += 1
    resetBoardState(nextBlack, forbiddenRef.current)
    setPhase('play')
    persistGomokuRoom()
    sessionRef.current.sendReliable({
      type: 'rematch',
      seq: seqRef.current,
      black: nextBlack,
    })
    sessionRef.current.sendReliable(buildSync())
  }

  async function leaveRoom() {
    if (leavingHubRef.current) return
    leavingHubRef.current = true
    resetReenter()
    const roomCode = codeRef.current || room.code
    if (!roomCode) {
      clearPeerRoom('gomoku')
      navigate('/games', { replace: true })
      return
    }
    setBusy(true)
    persistGomokuRoom()
    // 人机：保留 Bot 会话，回到已开房选游戏（可再开一局五子棋）
    if (isSoloRoomCode(roomCode)) {
      savePlayPeerRoom({
        game: 'hub',
        code: roomCode,
        role: 'host',
        who: whoRef.current,
        mode: 'solo',
        parkedGame: 'gomoku',
      })
      sessionRef.current = null
      navigate('/games?resume=1', { replace: true })
      return
    }
    await leaveGameToHub({
      sendReliable: (data, times) => room.sendReliable(data, times),
      code: roomCode,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
      navigate,
      fromGame: 'gomoku',
      onLocalLeave: () => {
        sessionRef.current = null
        peerWhoRef.current = null
        setPeerWho(null)
      },
    })
  }

  const solo = isSoloRoomCode(code)
  const peerName = solo ? '机器人' : peerWho ? aboutLabel(peerWho) : '对方'
  const myStone = stoneForPlayer(blackPlayer, who)
  const inMatch = phase === 'play' || phase === 'done'
  const mine = turn === who && !winner
  const lastBy =
    lastMove != null
      ? board[lastMove] === 'black'
        ? blackPlayer
        : board[lastMove] === 'white'
          ? otherAbout(blackPlayer)
          : null
      : null
  // 终盘不可悔棋；仅对局中、上一手是自己时可申请
  const canAskUndo =
    !winner &&
    phase === 'play' &&
    !undoAsk &&
    moveCount > 0 &&
    lastBy === who
  // 只能在自己还能落子时认输（轮到自己、对局中、无悔棋）
  const canResign = mine && phase === 'play' && !undoAsk
  const threatStone = otherStone(myStone)
  const runs = useMemo(() => {
    if (phase !== 'play') return { three: new Set<number>(), four: new Set<number>() }
    return findRunMarks(board, threatStone, forbidden)
  }, [board, threatStone, phase, forbidden])

  // 对局中 / 终盘锁滚动，避免手机端终盘还能上下滑
  useEffect(() => {
    if (!inMatch) return
    const html = document.documentElement
    const body = document.body
    const scrollY = window.scrollY
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
    }
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    return () => {
      html.style.overflow = prev.htmlOverflow
      body.style.overflow = prev.bodyOverflow
      body.style.position = prev.bodyPosition
      body.style.top = prev.bodyTop
      body.style.width = prev.bodyWidth
      window.scrollTo(0, scrollY)
    }
  }, [inMatch])

  return (
    <GameShell
      title="五子棋"
      blurb={RULE}
      compact={inMatch}
      dense={inMatch}
      onBackToHub={phase === 'lobby' ? undefined : () => void leaveRoom()}
      backBusy={busy}
    >
      {phase === 'lobby' ? (
        <EnterRoomGate
          busy={busy || recovering}
          status={
            busy || recovering
              ? bootStatus ||
                (recovering
                  ? '正在恢复棋局…'
                  : reenterRef.current > 0
                    ? `房间号释放中，正在重试（${reenterRef.current}/4）…`
                    : '正在回到房间…')
              : undefined
          }
          error={busy || recovering ? undefined : error}
          onRetry={resumeSavedRef.current ? () => retryResume() : undefined}
        />
      ) : null}

      {phase === 'wait' ? (
        <>
          {spectating ? <SpectatorBanner detail="等他们开局" /> : null}
          <RoomBanner
            code={solo ? '人机' : code}
            detail={
              spectating
                ? '旁观中'
                : peerWho
                  ? `${aboutLabel(who)} vs ${peerName}`
                  : `你是${aboutLabel(who)} · 等对方`
            }
          />
          {spectating ? (
            <p className="mb-4 text-sm text-[var(--ink-soft)]">
              只看不玩，棋盘会自动更新
            </p>
          ) : null}
          {!spectating && isHost ? (
            <div className="mb-4 space-y-4">
              <ForbiddenPicker
                forbidden={forbidden}
                onForbidden={setForbidden}
              />
              <button
                type="button"
                className="game-lobby-primary"
                disabled={busy || !peerReady}
                onClick={hostStart}
              >
                {peerReady ? '开始对局' : solo ? '机器人准备中…' : '等对方进房'}
              </button>
            </div>
          ) : null}
          {!spectating ? (
            <p className="text-sm text-[var(--ink-soft)]">
              {isHost
                ? peerReady
                  ? forbidden
                    ? '已开禁手（黑棋三三、四四、长连），可以开始'
                    : '无禁手，可以开始'
                  : solo
                    ? '机器人马上就位…'
                    : '选好后等对方加入'
                : '等房主选规则并开始…'}
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        </>
      ) : null}

      {inMatch ? (
        <div className="game-gomoku-screen">
          {spectating ? (
            <div className="mb-2">
              <SpectatorBanner />
            </div>
          ) : null}
          {/* 终局也保留占位，避免状态行消失导致棋盘上跳抖动 */}
          <div className="game-gomoku-status">
            <p className="text-sm text-[var(--ink)]">
              {phase === 'done'
                ? '对局结束'
                : spectating
                  ? `轮到${aboutLabel(turn)}`
                  : mine
                    ? '轮到你'
                    : `轮到${aboutLabel(turn)}`}
            </p>
            <p className="text-xs tracking-[0.1em] text-[var(--ink-soft)]">
              {spectating
                ? forbidden
                  ? '旁观 · 有禁手'
                  : '旁观 · 无禁手'
                : `你是${myStone === 'black' ? '黑' : '白'}${
                    forbidden && myStone === 'black' ? ' · 禁手' : ''
                  }${!forbidden ? ' · 无禁手' : forbidden && myStone === 'white' ? ' · 无禁手' : ''}`}
            </p>
          </div>

          <div
            className="game-gomoku-board"
            style={{ ['--gomoku-n' as string]: GOMOKU_SIZE }}
          >
            <div className="game-gomoku-grid" role="grid" aria-label="五子棋棋盘">
              {/* 整盘连续画线，避免每格拼十字在交叉点断开 */}
              <svg
                className="game-gomoku-lines"
                viewBox={`0 0 ${GOMOKU_SIZE} ${GOMOKU_SIZE}`}
                preserveAspectRatio="none"
                aria-hidden
              >
                {Array.from({ length: GOMOKU_SIZE }, (_, i) => (
                  <line
                    key={`v${i}`}
                    x1={i + 0.5}
                    y1={0.5}
                    x2={i + 0.5}
                    y2={GOMOKU_SIZE - 0.5}
                  />
                ))}
                {Array.from({ length: GOMOKU_SIZE }, (_, i) => (
                  <line
                    key={`h${i}`}
                    x1={0.5}
                    y1={i + 0.5}
                    x2={GOMOKU_SIZE - 0.5}
                    y2={i + 0.5}
                  />
                ))}
                {GOMOKU_STARS.map(([r, c]) => (
                  <circle key={`s${r}-${c}`} cx={c + 0.5} cy={r + 0.5} r={0.12} />
                ))}
              </svg>
              {board.map((cell, index) => {
                const isLast = index === lastMove
                const run4 = runs.four.has(index)
                const run3 = !run4 && runs.three.has(index)
                return (
                  <button
                    key={index}
                    type="button"
                    role="gridcell"
                    disabled={!!winner || !mine || !!undoAsk || cell != null}
                    onClick={() => playAt(index)}
                    className={[
                      'game-gomoku-cell',
                      cell ? 'has-stone' : '',
                      !cell && !winner && mine ? 'is-playable' : '',
                    ].join(' ')}
                    aria-label={
                      cell
                        ? cell === 'black'
                          ? '黑子'
                          : '白子'
                        : mine && !winner
                          ? '空位，可落子'
                          : '空位'
                    }
                  >
                    {cell ? (
                      <span
                        className={[
                          'game-gomoku-stone',
                          cell === 'black' ? 'is-black' : 'is-white',
                          run4 ? 'is-run4' : '',
                          run3 ? 'is-run3' : '',
                          isLast ? 'is-last' : '',
                        ].join(' ')}
                        aria-hidden
                      />
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 对局工具条 / 终局结算共用固定高度槽，避免棋盘尺寸与位置跳动 */}
          <div className="game-gomoku-foot">
            {phase === 'play' ? (
              <div className="game-gomoku-toolbar">
                <p className="game-gomoku-legend" aria-hidden>
                  <span className="is-three">对方三连</span>
                  <span className="is-four">对方四连</span>
                </p>
                <div className="game-gomoku-actions">
                  <button
                    type="button"
                    className="game-btn game-btn-ghost game-btn-sm"
                    disabled={!canAskUndo}
                    onClick={requestUndo}
                  >
                    {undoAsk === 'waiting' ? '悔棋中…' : '悔棋'}
                  </button>
                  <button
                    type="button"
                    className="game-btn game-btn-danger game-btn-sm"
                    disabled={!canResign}
                    onClick={requestResign}
                  >
                    认输
                  </button>
                </div>
              </div>
            ) : null}

            {phase === 'done' && winner ? (
              <div className="game-gomoku-end">
                <GomokuSettle
                  iWon={winner === who}
                  winnerName={aboutLabel(winner)}
                  loserName={aboutLabel(otherAbout(winner))}
                  winnerStone={stoneForPlayer(blackPlayer, winner)}
                  forbidden={forbidden}
                  endReason={endReason ?? 'five'}
                />
                {isHost ? (
                  <button
                    type="button"
                    className="game-btn game-btn-leaf game-btn-sm w-full"
                    onClick={rematch}
                  >
                    再来一局 · 黑白互换
                  </button>
                ) : (
                  <p className="text-center text-xs text-[var(--ink-soft)]">等开房的人再来一局</p>
                )}
              </div>
            ) : null}
          </div>

          {undoAsk === 'waiting' ? (
            <div className="game-gomoku-undo-wait" role="status">
              <p>已申请悔棋，等对方同意…</p>
              <button
                type="button"
                className="game-btn game-btn-ghost game-btn-sm"
                onClick={cancelUndoAsk}
              >
                取消申请
              </button>
            </div>
          ) : null}

          {undoAsk === 'decide' ? (
            <div className="game-gomoku-undo-ask" role="status">
              <p className="game-gomoku-undo-ask-text">
                <span className="game-gomoku-undo-ask-label">悔棋</span>
                对方想撤回上一手，可以吗？
              </p>
              <div className="game-gomoku-undo-ask-actions">
                <button type="button" className="game-gomoku-undo-yes" onClick={acceptUndo}>
                  同意
                </button>
                <button type="button" className="game-gomoku-undo-no" onClick={rejectUndo}>
                  拒绝
                </button>
              </div>
            </div>
          ) : null}

          {moveHint ? (
            <p className="text-center text-sm text-[#b42318]" role="status">
              {moveHint}
            </p>
          ) : null}

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </GameShell>
  )
}

function ForbiddenPicker({
  forbidden,
  onForbidden,
}: {
  forbidden: boolean
  onForbidden: (v: boolean) => void
}) {
  return (
    <div className="quiz-opts">
      <div>
        <p className="quiz-opts-label">禁手</p>
        <div className="quiz-opts-row">
          <button
            type="button"
            className={forbidden ? 'is-on' : ''}
            onClick={() => onForbidden(true)}
          >
            有（黑棋）
          </button>
          <button
            type="button"
            className={!forbidden ? 'is-on' : ''}
            onClick={() => onForbidden(false)}
          >
            无
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--ink-soft)]">
          有禁手时仅黑棋受连珠规则约束：长连、三三、四四；白棋无禁手。
        </p>
      </div>
    </div>
  )
}

function GomokuSettle({
  iWon,
  winnerName,
  loserName,
  winnerStone,
  forbidden,
  endReason,
}: {
  iWon: boolean
  winnerName: string
  loserName: string
  winnerStone: Stone
  forbidden: boolean
  endReason: EndReason
}) {
  const stoneLabel = winnerStone === 'black' ? '黑子' : '白子'
  const byResign = endReason === 'resign'
  const title = byResign
    ? iWon
      ? '对手认输'
      : '中盘认输'
    : iWon
      ? '五子连心'
      : '棋差一着'
  const eyebrow = iWon ? '本局告捷' : '本局落幕'
  const hint = byResign
    ? iWon
      ? `${loserName}认输，这盘归你`
      : `你认输了，${winnerName}获胜`
    : iWon
      ? `${stoneLabel}连成一线，这盘归你`
      : `${winnerName}的${stoneLabel}先成五，下局再扳回来`
  const ruleNote = forbidden ? '连珠禁手局' : '无禁手对局'

  return (
    <div
      className={`game-gomoku-settle is-${iWon ? 'win' : 'lose'}`}
      role="status"
    >
      <p className="game-gomoku-settle-eyebrow">{eyebrow}</p>
      <p className="game-gomoku-settle-title">{title}</p>
      <p className="game-gomoku-settle-hint">
        {hint}
        <span className="game-gomoku-settle-rule">{ruleNote}</span>
      </p>
    </div>
  )
}
