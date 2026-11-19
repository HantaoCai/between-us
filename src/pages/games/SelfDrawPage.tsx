import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnterRoomGate } from '../../components/EnterRoomGate'
import { GameShell } from '../../components/GameShell'
import { RoomBanner } from '../../components/PeerLobby'
import { RematchConsentBar } from '../../components/RematchConsentBar'
import {
  canvasToJpeg,
  clearDrawCanvas,
  DRAW_CANVAS_BG,
  DRAW_INK,
  DRAW_PEN_WIDTH,
  fitDrawCanvas,
  guessesMatch,
  paintStroke,
  relPointFromEvent,
  type DrawPoint,
  type DrawStroke,
} from '../../lib/drawCanvas'
import {
  applyPeerHelloIdentity,
  createPeerAwayHandlers,
  requirePeerOpenForAsk,
  requirePeerOpenForSync,
} from '../../lib/gameSession'
import { PEER_REMATCH_REJECTED_MSG, PEER_CLOSED_MSG } from '../../lib/peerConfig'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import { type RoomHandlers, type RoomSession } from '../../lib/peerRoom'
import { usePeerRoom } from '../../lib/PeerRoomContext'
import { peerRoomMeta, useFlushPeerRoomOnLeave } from '../../lib/peerRoomSave'
import {
  buildDistractTasks,
  checkDistractAnswer,
  type DistractTask,
} from '../../lib/selfDrawDistract'
import {
  isLegacyRematchWire,
  isRematchWire,
  useRematchConsent,
} from '../../lib/rematchConsent'
import { usePeerGameSession } from '../../lib/usePeerGameSession'
import { usePeerSessionGuard } from '../../lib/usePeerSessionGuard'

const RULE =
  '一方出题，另一方限时速画；画完后算数、绕口令打乱记忆，再随机翻出画作让作画的人认自己画的是什么。出题方全程能看到原题。'

const DEFAULT_TOTAL = 12
const DEFAULT_SECS = 5

type Phase =
  | 'lobby'
  | 'wait'
  | 'pick'
  | 'ready'
  | 'ink'
  | 'distract'
  | 'recall'
  | 'done'

type Piece = {
  index: number
  word: string
  image: string
}

type RecallMark = {
  guess: string
  ok: boolean
}

type Msg =
  | { type: 'hello'; who: NoteAbout }
  | { type: 'role'; drawer: NoteAbout; total: number; secs: number }
  | { type: 'prompt'; index: number; word: string }
  | { type: 'stroke'; stroke: DrawStroke }
  | { type: 'clear' }
  | { type: 'snapshot'; index: number; word: string; image: string }
  | { type: 'distract'; tasks: DistractTask[] }
  | { type: 'distract-done' }
  | { type: 'recall'; order: number[] }
  | {
      type: 'answer'
      pieceIndex: number
      guess: string
      ok: boolean
      score: number
    }
  /** 作画方展示完结果后推进认图；at 为下一题下标，-1 表示结束 */
  | { type: 'recall-advance'; at: number }
  | { type: 'need-sync' }
  | { type: 'sync'; drawer: NoteAbout; total: number; secs: number }

function shuffleOrder(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

export function SelfDrawPage() {
  const navigate = useNavigate()
  const room = usePeerRoom()
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [code, setCode] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drawer, setDrawer] = useState<NoteAbout | null>(null)
  const [total, setTotal] = useState(DEFAULT_TOTAL)
  const [secs, setSecs] = useState(DEFAULT_SECS)
  const [left, setLeft] = useState(0)
  const [word, setWord] = useState('')
  const [draft, setDraft] = useState('')
  const [pieces, setPieces] = useState<Piece[]>([])
  const [roundIndex, setRoundIndex] = useState(0)
  const [tasks, setTasks] = useState<DistractTask[]>([])
  const [taskAt, setTaskAt] = useState(0)
  const [taskDraft, setTaskDraft] = useState('')
  const [taskHint, setTaskHint] = useState('')
  const [recallOrder, setRecallOrder] = useState<number[]>([])
  const [recallAt, setRecallAt] = useState(0)
  const [score, setScore] = useState(0)
  const [marks, setMarks] = useState<Record<number, RecallMark>>({})
  const [lastResult, setLastResult] = useState<{
    guess: string
    word: string
    ok: boolean
  } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const stroke = useRef<DrawPoint[]>([])
  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  const peerWhoRef = useRef<NoteAbout | null>(null)
  const codeRef = useRef(code)
  const isHostRef = useRef(isHost)
  const drawerRef = useRef<NoteAbout | null>(null)
  const phaseRef = useRef<Phase>('lobby')
  const wordRef = useRef('')
  const roundRef = useRef(0)
  const piecesRef = useRef<Piece[]>([])
  const totalRef = useRef(DEFAULT_TOTAL)
  const secsRef = useRef(DEFAULT_SECS)
  const scoreRef = useRef(0)
  const marksRef = useRef<Record<number, RecallMark>>({})
  const recallOrderRef = useRef<number[]>([])
  const recallAtRef = useRef(0)
  const snapBusyRef = useRef(false)
  const timerRef = useRef(0)
  const leavingHubRef = useRef(false)

  whoRef.current = who
  peerWhoRef.current = peerWho
  codeRef.current = code
  isHostRef.current = isHost
  drawerRef.current = drawer
  phaseRef.current = phase
  wordRef.current = word
  roundRef.current = roundIndex
  piecesRef.current = pieces
  totalRef.current = total
  secsRef.current = secs
  scoreRef.current = score
  marksRef.current = marks
  recallOrderRef.current = recallOrder
  recallAtRef.current = recallAt

  const amDrawer = drawer === who
  const amPrompter = drawer != null && drawer !== who
  const inMatch =
    phase === 'pick' ||
    phase === 'ready' ||
    phase === 'ink' ||
    phase === 'distract' ||
    phase === 'recall' ||
    phase === 'done'

  const rematchOnAgreedRef = useRef(() => {})
  const rematch = useRematchConsent({
    sendReliable: (msg) => sessionRef.current?.sendReliable(msg),
    onAgreed: () => rematchOnAgreedRef.current(),
    isConnected: () => !!sessionRef.current?.conn?.open,
  })

  const sessionApiRef = useRef({
    makeHandlers: (): RoomHandlers => ({
      onData: () => {},
    }),
    afterBind: (_info: {
      session: RoomSession
      role: 'host' | 'joiner'
      source: string
    }) => {},
    onRoomOpen: () => {},
    onFailLobby: () => {},
  })

  const peer = usePeerGameSession({
    game: 'selfdraw',
    navigate,
    room,
    sessionRef,
    whoRef,
    peerWhoRef,
    isHostRef,
    codeRef,
    leavingHubRef,
    setWho,
    setPeerWho,
    setIsHost,
    setCode,
    setBusy,
    setError,
    makeHandlers: () => sessionApiRef.current.makeHandlers(),
    afterBind: (info) => sessionApiRef.current.afterBind(info),
    onRoomOpen: () => sessionApiRef.current.onRoomOpen(),
    onFailLobby: () => sessionApiRef.current.onFailLobby(),
    supportsSolo: false,
  })

  usePeerSessionGuard(sessionRef, () => true)

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!code) return null
    return peerRoomMeta({
      game: 'selfdraw',
      code,
      role: isHost ? 'host' : 'joiner',
      who: whoRef.current,
    })
  })

  useEffect(
    () => () => {
      window.clearInterval(timerRef.current)
    },
    [],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (phase !== 'ready' && phase !== 'ink') return
    const board = canvas.parentElement
    const host = board?.parentElement ?? board
    if (!host) return
    fitDrawCanvas(canvas, { host, chrome: amDrawer ? 200 : 180, max: 520 })
  }, [phase, amDrawer, roundIndex])

  function goPhase(next: Phase) {
    phaseRef.current = next
    setPhase(next)
  }

  function send(msg: Msg) {
    sessionRef.current?.send(msg)
  }

  function sendReliable(msg: Msg) {
    sessionRef.current?.sendReliable(msg)
  }

  function hello() {
    sendReliable({ type: 'hello', who: whoRef.current })
  }

  function resetMatch() {
    window.clearInterval(timerRef.current)
    snapBusyRef.current = false
    setPieces([])
    piecesRef.current = []
    setRoundIndex(0)
    roundRef.current = 0
    setWord('')
    wordRef.current = ''
    setDraft('')
    setTasks([])
    setTaskAt(0)
    setTaskDraft('')
    setTaskHint('')
    setRecallOrder([])
    recallOrderRef.current = []
    setRecallAt(0)
    recallAtRef.current = 0
    setScore(0)
    scoreRef.current = 0
    setMarks({})
    marksRef.current = {}
    setLastResult(null)
    setLeft(0)
  }

  function applyRole(nextDrawer: NoteAbout, nextTotal: number, nextSecs: number) {
    resetMatch()
    setDrawer(nextDrawer)
    drawerRef.current = nextDrawer
    setTotal(nextTotal)
    totalRef.current = nextTotal
    setSecs(nextSecs)
    secsRef.current = nextSecs
    goPhase('ready')
    requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (canvas) clearDrawCanvas(canvas)
    })
  }

  function startInk(index: number, nextWord: string) {
    window.clearInterval(timerRef.current)
    snapBusyRef.current = false
    setRoundIndex(index)
    roundRef.current = index
    setWord(nextWord)
    wordRef.current = nextWord
    setDraft('')
    setLastResult(null)
    goPhase('ink')
    requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (canvas) clearDrawCanvas(canvas)
    })
    const limit = secsRef.current
    setLeft(limit)
    let remain = limit
    timerRef.current = window.setInterval(() => {
      remain -= 1
      setLeft(remain)
      if (remain <= 0) {
        window.clearInterval(timerRef.current)
        void finishInkRound()
      }
    }, 1000)
  }

  async function finishInkRound() {
    if (snapBusyRef.current) return
    if (phaseRef.current !== 'ink') return
    // 作画方出图；出题方只等 snapshot
    if (drawerRef.current !== whoRef.current) return
    snapBusyRef.current = true
    window.clearInterval(timerRef.current)
    const canvas = canvasRef.current
    const index = roundRef.current
    const w = wordRef.current
    let image = ''
    try {
      if (canvas) {
        image = canvasToJpeg(canvas, { quality: 0.55, maxEdge: 360 })
      }
    } catch {
      image = ''
    }
    const piece: Piece = { index, word: w, image }
    const next = [...piecesRef.current.filter((p) => p.index !== index), piece].sort(
      (a, b) => a.index - b.index,
    )
    piecesRef.current = next
    setPieces(next)
    sendReliable({ type: 'snapshot', index, word: w, image })
    afterSnapshot(next)
  }

  function afterSnapshot(list: Piece[]) {
    snapBusyRef.current = false
    if (list.length >= totalRef.current) {
      beginDistract()
      return
    }
    goPhase('ready')
    requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (canvas) clearDrawCanvas(canvas)
    })
  }

  function beginDistract() {
    window.clearInterval(timerRef.current)
    // 作画方本地生成干扰题并同步给对方看进度
    if (drawerRef.current === whoRef.current) {
      const nextTasks = buildDistractTasks(3, 2)
      setTasks(nextTasks)
      setTaskAt(0)
      setTaskDraft('')
      setTaskHint('')
      sendReliable({ type: 'distract', tasks: nextTasks })
      goPhase('distract')
      return
    }
    goPhase('distract')
  }

  function submitDistract() {
    if (!amDrawer) return
    const task = tasks[taskAt]
    if (!task) return
    if (!checkDistractAnswer(task, taskDraft)) {
      setTaskHint(task.kind === 'math' ? '再算一下' : '再打一遍，要一字不差')
      return
    }
    setTaskHint('')
    setTaskDraft('')
    const next = taskAt + 1
    if (next >= tasks.length) {
      sendReliable({ type: 'distract-done' })
      startRecallLocal()
      return
    }
    setTaskAt(next)
  }

  function startRecallLocal() {
    const order = shuffleOrder(piecesRef.current.length)
    recallOrderRef.current = order
    setRecallOrder(order)
    setRecallAt(0)
    recallAtRef.current = 0
    setScore(0)
    scoreRef.current = 0
    setMarks({})
    marksRef.current = {}
    setLastResult(null)
    setDraft('')
    sendReliable({ type: 'recall', order })
    goPhase('recall')
  }

  function applyRecall(order: number[]) {
    recallOrderRef.current = order
    setRecallOrder(order)
    setRecallAt(0)
    recallAtRef.current = 0
    setScore(0)
    scoreRef.current = 0
    setMarks({})
    marksRef.current = {}
    setLastResult(null)
    setDraft('')
    goPhase('recall')
  }

  function recordMark(pieceIndex: number, guess: string, ok: boolean) {
    const next = { ...marksRef.current, [pieceIndex]: { guess, ok } }
    marksRef.current = next
    setMarks(next)
  }

  function currentRecallPiece(): Piece | null {
    const idx = recallOrderRef.current[recallAtRef.current]
    if (idx == null) return null
    return piecesRef.current.find((p) => p.index === idx) ?? null
  }

  function submitRecall() {
    if (!amDrawer || phaseRef.current !== 'recall') return
    const piece = currentRecallPiece()
    if (!piece) return
    const guess = draft.trim()
    if (!guess) return
    const ok = guessesMatch(guess, piece.word)
    const nextScore = scoreRef.current + (ok ? 1 : 0)
    scoreRef.current = nextScore
    setScore(nextScore)
    recordMark(piece.index, guess, ok)
    setLastResult({ guess, word: piece.word, ok })
    setDraft('')
    sendReliable({
      type: 'answer',
      pieceIndex: piece.index,
      guess,
      ok,
      score: nextScore,
    })
    const nextAt =
      recallAtRef.current + 1 >= recallOrderRef.current.length
        ? -1
        : recallAtRef.current + 1
    window.setTimeout(() => {
      sendReliable({ type: 'recall-advance', at: nextAt })
      applyRecallAdvance(nextAt)
    }, 900)
  }

  function applyRecallAdvance(nextAt: number) {
    if (phaseRef.current !== 'recall') return
    if (nextAt < 0) {
      goPhase('done')
      return
    }
    recallAtRef.current = nextAt
    setRecallAt(nextAt)
    setLastResult(null)
  }

  function pickDrawer(next: NoteAbout) {
    if (!isHostRef.current || !peerWho) return
    sendReliable({
      type: 'role',
      drawer: next,
      total: DEFAULT_TOTAL,
      secs: DEFAULT_SECS,
    })
    applyRole(next, DEFAULT_TOTAL, DEFAULT_SECS)
  }

  function submitPrompt() {
    if (!amPrompter || phase !== 'ready') return
    const text = draft.trim()
    if (!text) return
    const index = piecesRef.current.length
    if (index >= totalRef.current) return
    setDraft('')
    sendReliable({ type: 'prompt', index, word: text })
    startInk(index, text)
  }

  // 双方同意后换人再来：没有随机内容，各自本地换画手重开（无需房主发包）
  rematchOnAgreedRef.current = () => {
    setError('')
    if (!drawerRef.current) return
    applyRole(otherAbout(drawerRef.current), DEFAULT_TOTAL, DEFAULT_SECS)
  }

  function askRestart() {
    if (!requirePeerOpenForAsk(() => !!sessionRef.current?.conn?.open, setError)) return
    rematch.askRestart()
  }

  /** 房主把已定的角色推给对方（对方还没有角色时才会采纳） */
  function pushSync() {
    if (!isHostRef.current || !drawerRef.current) return
    sendReliable({
      type: 'sync',
      drawer: drawerRef.current,
      total: totalRef.current,
      secs: secsRef.current,
    })
  }

  function syncState(): boolean {
    if (!requirePeerOpenForSync(() => !!sessionRef.current?.conn?.open, setError)) return false
    hello()
    if (isHostRef.current) pushSync()
    else sendReliable({ type: 'need-sync' })
    return true
  }

  function onData(raw: unknown) {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return
    if (isRematchWire(raw)) {
      const kind = rematch.handleWire(raw)
      if (kind === 'rejected') setError(PEER_REMATCH_REJECTED_MSG)
      return
    }
    if (isLegacyRematchWire(raw)) {
      rematch.handleLegacyRematch(raw)
      return
    }
    const msg = raw as Msg

    if (msg.type === 'hello') {
      applyPeerHelloIdentity({
        peerWho: msg.who,
        isHost: !!sessionRef.current?.isHost,
        whoRef,
        setWho,
        setPeerWho,
        sendHello: () => hello(),
      })
      if (sessionRef.current?.isHost && phaseRef.current === 'wait') {
        goPhase('pick')
      }
      return
    }
    if (msg.type === 'role') {
      applyRole(msg.drawer, msg.total, msg.secs)
      return
    }
    if (msg.type === 'need-sync') {
      if (sessionRef.current?.isHost) pushSync()
      return
    }
    if (msg.type === 'sync') {
      if (sessionRef.current?.isHost) return
      if (msg.drawer !== 'her' && msg.drawer !== 'me') return
      if (!Number.isInteger(msg.total) || msg.total < 1 || msg.total > 50) return
      if (!Number.isInteger(msg.secs) || msg.secs < 1 || msg.secs > 60) return
      // 只在对方还没有角色（丢了 role 包）或角色对不上时对齐房主
      if (drawerRef.current !== msg.drawer) applyRole(msg.drawer, msg.total, msg.secs)
      return
    }
    if (msg.type === 'prompt') {
      startInk(msg.index, msg.word)
      return
    }
    if (msg.type === 'stroke') {
      const canvas = canvasRef.current
      if (canvas) paintStroke(canvas, msg.stroke)
      return
    }
    if (msg.type === 'clear') {
      const canvas = canvasRef.current
      if (canvas) clearDrawCanvas(canvas)
      return
    }
    if (msg.type === 'snapshot') {
      const piece: Piece = {
        index: msg.index,
        word: msg.word,
        image: msg.image,
      }
      const next = [
        ...piecesRef.current.filter((p) => p.index !== piece.index),
        piece,
      ].sort((a, b) => a.index - b.index)
      piecesRef.current = next
      setPieces(next)
      afterSnapshot(next)
      return
    }
    if (msg.type === 'distract') {
      setTasks(msg.tasks)
      setTaskAt(0)
      setTaskDraft('')
      setTaskHint('')
      goPhase('distract')
      return
    }
    if (msg.type === 'distract-done') {
      // 出题方等作画方开认图；若对方已发 recall 会覆盖
      return
    }
    if (msg.type === 'recall') {
      applyRecall(msg.order)
      return
    }
    if (msg.type === 'answer') {
      // 先对齐到正在揭晓的那一幅，再等作画方的 recall-advance 翻下一张
      const orderIdx = recallOrderRef.current.indexOf(msg.pieceIndex)
      if (orderIdx >= 0) {
        recallAtRef.current = orderIdx
        setRecallAt(orderIdx)
      }
      scoreRef.current = msg.score
      setScore(msg.score)
      recordMark(msg.pieceIndex, msg.guess, msg.ok)
      const piece = piecesRef.current.find((p) => p.index === msg.pieceIndex)
      setLastResult({
        guess: msg.guess,
        word: piece?.word ?? '',
        ok: msg.ok,
      })
      return
    }
    if (msg.type === 'recall-advance') {
      applyRecallAdvance(msg.at)
    }
  }

  useEffect(() => {
    if (!isHost || !peerWho || phase !== 'wait') return
    goPhase('pick')
  }, [isHost, peerWho, phase])

  function onRoomOpen() {
    setError('')
    hello()
  }

  function selfHandlers() {
    return {
      onData,
      onOpen: onRoomOpen,
      ...createPeerAwayHandlers({
        setError,
        getSession: () => sessionRef.current,
        closedMsg: PEER_CLOSED_MSG,
        onWake: () => {
          hello()
          if (isHostRef.current) pushSync()
          else sendReliable({ type: 'need-sync' })
        },
      }),
    }
  }

  sessionApiRef.current = {
    makeHandlers: () => selfHandlers(),
    afterBind: () => goPhase('wait'),
    onRoomOpen,
    onFailLobby: () => goPhase('lobby'),
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!amDrawer || phase !== 'ink') return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    stroke.current = [relPointFromEvent(e)]
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !amDrawer || phase !== 'ink') return
    stroke.current.push(relPointFromEvent(e))
    const pts = stroke.current
    if (pts.length < 2) return
    const canvas = canvasRef.current
    if (!canvas) return
    paintStroke(canvas, {
      points: pts.slice(-2),
      color: DRAW_INK,
      width: DRAW_PEN_WIDTH,
    })
  }

  function onPointerUp() {
    if (!drawing.current || !amDrawer) return
    drawing.current = false
    if (stroke.current.length > 1) {
      send({
        type: 'stroke',
        stroke: {
          points: stroke.current,
          color: DRAW_INK,
          width: DRAW_PEN_WIDTH,
        },
      })
    }
    stroke.current = []
  }

  const recallPiece = currentRecallPiece()
  const distractTask = tasks[taskAt]

  return (
    <GameShell
      title="你画你猜"
      blurb={RULE}
      compact={inMatch}
      dense={inMatch}
      onBackToHub={phase === 'lobby' ? undefined : () => void peer.leave()}
      backBusy={busy}
      onSyncState={phase !== 'lobby' ? syncState : undefined}
    >
      {phase === 'lobby' ? (
        <EnterRoomGate
          busy={busy}
          status={busy ? '正在回到房间…' : undefined}
          error={busy ? undefined : error}
          onRetry={peer.resumeSavedRef.current ? () => peer.retryResume() : undefined}
        />
      ) : null}

      {phase === 'wait' ? (
        <>
          <RoomBanner
            code={code}
            detail={peerWho ? '对方已到' : '等待对方…'}
          />
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            {isHost ? '等对方进来后选谁来画' : '已进房，等房主安排角色…'}
          </p>
        </>
      ) : null}

      {phase === 'pick' ? (
        <div className="space-y-3">
          <RoomBanner code={code} detail="选谁来画" />
          <p className="text-sm text-[var(--ink-soft)]">
            作画的人限时速画，之后要自己认图；另一方负责出题，认图时能看到原题。
          </p>
          {isHost ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="game-btn game-btn-leaf flex-1"
                onClick={() => pickDrawer(who)}
              >
                我来画
              </button>
              <button
                type="button"
                className="game-btn game-btn-ink flex-1"
                onClick={() => pickDrawer(otherAbout(who))}
              >
                对方画
              </button>
            </div>
          ) : (
            <p className="text-center text-sm text-[var(--ink-soft)]">
              等开房的人选定角色…
            </p>
          )}
        </div>
      ) : null}

      {phase === 'ready' || phase === 'ink' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--ink-soft)]">
            <p>
              {pieces.length}/{total} 幅 · {amDrawer ? '你画' : '你出题'} · 每幅{' '}
              {secs}s
            </p>
            {phase === 'ink' ? (
              <p className="font-display text-lg text-[var(--leaf)]">{left}s</p>
            ) : null}
          </div>

          {amDrawer ? (
            phase === 'ink' ? (
              <p className="font-display text-xl text-[var(--leaf)]">画：{word}</p>
            ) : (
              <p className="text-sm text-[var(--ink-soft)]">等对方出下一题…</p>
            )
          ) : phase === 'ink' ? (
            <p className="text-sm text-[var(--ink-soft)]">
              对方在画「{word}」· 你看得到原题
            </p>
          ) : (
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="打个标题，马上开画"
                className="min-h-10 min-w-0 flex-1 bg-white/70 px-3 text-base outline-none ring-1 ring-[var(--leaf)]/20"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitPrompt()
                }}
              />
              <button
                type="button"
                onClick={submitPrompt}
                className="min-h-10 shrink-0 bg-[var(--leaf)] px-4 text-[var(--foam)]"
              >
                出题
              </button>
            </div>
          )}

          <div className="draw-board relative mx-auto w-full max-w-full">
            <canvas
              ref={canvasRef}
              className="mx-auto block max-w-full touch-none bg-[#f7f4ee] ring-1 ring-[var(--leaf)]/15"
              style={{
                touchAction: 'none',
                cursor: amDrawer && phase === 'ink' ? 'crosshair' : 'default',
                background: DRAW_CANVAS_BG,
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>

          {amDrawer && phase === 'ink' ? (
            <p className="text-center text-xs text-[var(--ink-soft)]">
              一支笔，抓紧画
            </p>
          ) : null}
        </div>
      ) : null}

      {phase === 'distract' ? (
        <div className="space-y-3">
          <p className="font-display text-2xl text-[var(--leaf)]">混淆记忆</p>
          {amDrawer ? (
            distractTask ? (
              <>
                <p className="text-sm text-[var(--ink-soft)]">
                  {taskAt + 1}/{tasks.length} ·{' '}
                  {distractTask.kind === 'math' ? '算一算' : '绕口令'}
                </p>
                <p className="text-base leading-relaxed text-[var(--ink)]">
                  {distractTask.prompt}
                </p>
                <input
                  value={taskDraft}
                  onChange={(e) => setTaskDraft(e.target.value)}
                  placeholder={
                    distractTask.kind === 'math' ? '答案' : '完整打出上面那句'
                  }
                  className="min-h-10 w-full bg-white/70 px-3 text-base outline-none ring-1 ring-[var(--leaf)]/20"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitDistract()
                  }}
                />
                {taskHint ? (
                  <p className="text-sm text-red-700">{taskHint}</p>
                ) : null}
                <button
                  type="button"
                  onClick={submitDistract}
                  className="game-btn game-btn-leaf w-full"
                >
                  下一题
                </button>
              </>
            ) : (
              <p className="text-sm text-[var(--ink-soft)]">准备认图…</p>
            )
          ) : (
            <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
              对方正在算数、打绕口令，把刚才画的忘干净一点。你稍后认图时仍看得到原题。
            </p>
          )}
        </div>
      ) : null}

      {phase === 'recall' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-[var(--ink-soft)]">
            <p>
              认图 {Math.min(recallAt + 1, recallOrder.length)}/
              {recallOrder.length} · 对了 {score} 幅
            </p>
            {amPrompter ? <p>你看得到原题</p> : null}
          </div>

          {recallPiece ? (
            <>
              <img
                src={recallPiece.image}
                alt=""
                className="mx-auto max-h-[46vh] w-full max-w-md object-contain ring-1 ring-[var(--leaf)]/15"
              />
              {amPrompter ? (
                <p className="text-center font-display text-xl text-[var(--leaf)]">
                  原题：{recallPiece.word}
                </p>
              ) : null}
              {lastResult ? (
                <p
                  className={`text-center text-sm ${
                    lastResult.ok ? 'text-[var(--leaf)]' : 'text-red-700'
                  }`}
                >
                  {lastResult.ok
                    ? `对了 · ${lastResult.guess}`
                    : `说成「${lastResult.guess}」· 其实是「${lastResult.word}」`}
                </p>
              ) : amDrawer ? (
                <div className="flex gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="这幅画的是什么？"
                    className="min-h-10 min-w-0 flex-1 bg-white/70 px-3 text-base outline-none ring-1 ring-[var(--leaf)]/20"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRecall()
                    }}
                  />
                  <button
                    type="button"
                    onClick={submitRecall}
                    className="min-h-10 shrink-0 bg-[var(--leaf)] px-4 text-[var(--foam)]"
                  >
                    认
                  </button>
                </div>
              ) : (
                <p className="text-center text-sm text-[var(--ink-soft)]">
                  等对方认…
                </p>
              )}
            </>
          ) : null}
        </div>
      ) : null}

      {phase === 'done' ? (
        <div className="selfdraw-review">
          <div className="selfdraw-review-head">
            <p className="selfdraw-review-title font-display">认完了</p>
            <p className="selfdraw-review-score font-display">
              <span>{score}</span>
              <span className="selfdraw-review-score-den">/{pieces.length}</span>
            </p>
            <p className="selfdraw-review-meta">
              {aboutLabel(drawer ?? 'her')} 认对 {score} 幅
            </p>
          </div>
          <ul className="selfdraw-review-grid">
            {pieces.map((p) => {
              const mark = marks[p.index]
              return (
                <li
                  key={p.index}
                  className={`selfdraw-review-item${
                    mark ? (mark.ok ? ' is-ok' : ' is-miss') : ''
                  }`}
                >
                  <div className="selfdraw-review-frame">
                    {p.image ? (
                      <img src={p.image} alt="" />
                    ) : (
                      <span className="selfdraw-review-empty">空</span>
                    )}
                  </div>
                  <p className="selfdraw-review-word">{p.word}</p>
                  {mark && !mark.ok ? (
                    <p className="selfdraw-review-guess">说成「{mark.guess}」</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <RematchConsentBar
            ask={rematch.ask}
            askLabel="申请换人再来一局"
            decideLabel="对方申请换人再来一局"
            onAsk={askRestart}
            onAccept={() => rematch.accept()}
            onReject={() => rematch.reject()}
          />
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </GameShell>
  )
}
