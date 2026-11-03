import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnterRoomGate } from '../../components/EnterRoomGate'
import { GameShell } from '../../components/GameShell'
import { RoomBanner } from '../../components/PeerLobby'
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
import { wrapGameHandlers } from '../../lib/gameSession'
import { leaveGameToHub } from '../../lib/hubNav'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import {
  adoptParkedSession,
  releaseParkedRoom,
} from '../../lib/peerHandoff'
import {
  createPeerRoom,
  joinPeerRoom,
  type RoomHandlers,
  type RoomSession,
} from '../../lib/peerRoom'
import { usePeerRoom } from '../../lib/PeerRoomContext'
import {
  peerRoomMeta,
  savePlayPeerRoom,
  useFlushPeerRoomOnLeave,
} from '../../lib/peerRoomSave'
import {
  buildDistractTasks,
  checkDistractAnswer,
  type DistractTask,
} from '../../lib/selfDrawDistract'
import { useGamePeerBoot } from '../../lib/useGamePeerBoot'
import { usePeerSessionGuard } from '../../lib/usePeerSessionGuard'

const RULE =
  '一方出题，另一方限时速画；画完后算数、绕口令打乱记忆，再随机翻出画作让作画的人认自己画的是什么。出题方全程能看到原题。'

const DEFAULT_TOTAL = 12
const DEFAULT_SECS = 10

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
  | { type: 'again'; drawer: NoteAbout; total: number; secs: number }

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
  const recallOrderRef = useRef<number[]>([])
  const recallAtRef = useRef(0)
  const snapBusyRef = useRef(false)
  const timerRef = useRef(0)
  const leavingHubRef = useRef(false)

  whoRef.current = who
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

  const resumeSavedRef = useRef<{
    code: string
    role: 'host' | 'joiner'
    who: NoteAbout
  } | null>(null)

  useGamePeerBoot(
    'selfdraw',
    () => {
      adoptLiveFromProvider()
    },
    (saved) => {
      resumeSavedRef.current = {
        code: saved.code,
        role: saved.role,
        who: saved.who,
      }
      setBusy(true)
      setError('')
      whoRef.current = saved.who
      setWho(saved.who)
      if (saved.role === 'host') void create(saved.code)
      else void join(saved.code)
    },
  )

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

  function flashError(msg: string) {
    setError(msg)
  }

  function adoptLiveFromProvider() {
    const session = room.session
    if (!session) return
    room.bindHandlers(navHandlers(selfHandlers()))
    sessionRef.current = session
    whoRef.current = room.who
    setWho(room.who)
    isHostRef.current = room.isHost
    setIsHost(room.isHost)
    codeRef.current = room.code
    setCode(room.code)
    if (room.peerWho) setPeerWho(room.peerWho)
    goPhase('wait')
    setBusy(false)
    setError('')
    if (session.conn?.open) hello()
  }

  function retryResume() {
    const saved = resumeSavedRef.current
    if (!saved) return
    setBusy(true)
    setError('')
    whoRef.current = saved.who
    setWho(saved.who)
    if (saved.role === 'host') void create(saved.code)
    else void join(saved.code)
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
    setLastResult(null)
    setDraft('')
    goPhase('recall')
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
    setLastResult({ guess, word: piece.word, ok })
    setDraft('')
    sendReliable({
      type: 'answer',
      pieceIndex: piece.index,
      guess,
      ok,
      score: nextScore,
    })
    window.setTimeout(() => advanceRecall(), 900)
  }

  function advanceRecall() {
    const next = recallAtRef.current + 1
    if (next >= recallOrderRef.current.length) {
      goPhase('done')
      return
    }
    recallAtRef.current = next
    setRecallAt(next)
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

  function againGame() {
    if (!isHostRef.current || !drawerRef.current) return
    const nextDrawer = otherAbout(drawerRef.current)
    sendReliable({
      type: 'again',
      drawer: nextDrawer,
      total: DEFAULT_TOTAL,
      secs: DEFAULT_SECS,
    })
    applyRole(nextDrawer, DEFAULT_TOTAL, DEFAULT_SECS)
  }

  async function goHub() {
    if (leavingHubRef.current) return
    leavingHubRef.current = true
    const roomCode = codeRef.current || room.code
    if (!roomCode) {
      navigate('/games', { replace: true })
      return
    }
    setBusy(true)
    setError('')
    await leaveGameToHub({
      sendReliable: (data, times) => room.sendReliable(data, times),
      code: roomCode,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
      navigate,
      fromGame: 'selfdraw',
      onLocalLeave: () => {
        sessionRef.current = null
      },
    })
  }

  function onData(raw: unknown) {
    const msg = raw as Msg
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return

    if (msg.type === 'hello') {
      setPeerWho(msg.who)
      if (!sessionRef.current?.isHost) {
        const mine = otherAbout(msg.who)
        if (whoRef.current !== mine) {
          setWho(mine)
          whoRef.current = mine
          sendReliable({ type: 'hello', who: mine })
        }
      } else if (phaseRef.current === 'wait') {
        goPhase('pick')
      }
      return
    }
    if (msg.type === 'role' || msg.type === 'again') {
      applyRole(msg.drawer, msg.total, msg.secs)
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
      scoreRef.current = msg.score
      setScore(msg.score)
      const piece = piecesRef.current.find((p) => p.index === msg.pieceIndex)
      setLastResult({
        guess: msg.guess,
        word: piece?.word ?? '',
        ok: msg.ok,
      })
      window.setTimeout(() => advanceRecall(), 900)
    }
  }

  useEffect(() => {
    if (!isHost || !peerWho || phase !== 'wait') return
    goPhase('pick')
  }, [isHost, peerWho, phase])

  function selfHandlers() {
    return {
      onData,
      onOpen: () => {
        setError('')
        hello()
      },
      onDisconnect: () => flashError('对方暂时断线了，正在等他回来…'),
      onClose: () => flashError('对方断开了'),
    }
  }

  function navHandlers(handlers: RoomHandlers) {
    return wrapGameHandlers(handlers, {
      hereGame: 'selfdraw',
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

  function bindSession(
    session: RoomSession,
    role: 'host' | 'joiner',
    kickOpen: boolean,
  ) {
    sessionRef.current = session
    room.attachSession(session, { who: whoRef.current })
    room.bindHandlers(navHandlers(selfHandlers()))
    isHostRef.current = role === 'host'
    setIsHost(role === 'host')
    codeRef.current = session.code
    setCode(session.code)
    goPhase('wait')
    savePlayPeerRoom({
      game: 'selfdraw',
      code: session.code,
      role,
      who: whoRef.current,
    })
    if (kickOpen && session.conn?.open) {
      setError('')
      hello()
    }
  }

  async function create(existingCode?: string) {
    setBusy(true)
    setError('')
    try {
      const handlers = navHandlers(selfHandlers())
      if (existingCode) {
        const live = await adoptParkedSession(existingCode, true, handlers)
        if (live) {
          bindSession(live, 'host', true)
          return
        }
      }
      sessionRef.current?.destroy()
      sessionRef.current = null
      if (existingCode) await releaseParkedRoom(existingCode)
      const session = await createPeerRoom(
        handlers,
        existingCode ? { code: existingCode } : undefined,
      )
      bindSession(session, 'host', false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '开房失败')
    } finally {
      setBusy(false)
    }
  }

  async function join(roomCode: string) {
    setBusy(true)
    setError('')
    try {
      const handlers = navHandlers(selfHandlers())
      const live = await adoptParkedSession(roomCode, false, handlers)
      if (live) {
        bindSession(live, 'joiner', true)
        return
      }
      sessionRef.current?.destroy()
      sessionRef.current = null
      await releaseParkedRoom(roomCode)
      const session = await joinPeerRoom(roomCode, handlers)
      bindSession(session, 'joiner', false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加入失败')
    } finally {
      setBusy(false)
    }
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
      onBackToHub={phase === 'lobby' ? undefined : () => void goHub()}
      backBusy={busy}
    >
      {phase === 'lobby' ? (
        <EnterRoomGate
          busy={busy}
          status={busy ? '正在回到房间…' : undefined}
          error={busy ? undefined : error}
          onRetry={resumeSavedRef.current ? () => retryResume() : undefined}
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
        <div className="space-y-3">
          <p className="font-display text-2xl text-[var(--leaf)]">认完了</p>
          <p className="text-sm text-[var(--ink-soft)]">
            {aboutLabel(drawer ?? 'her')} 认对 {score}/{pieces.length} 幅
          </p>
          <ul className="max-h-56 space-y-2 overflow-y-auto">
            {pieces.map((p) => (
              <li key={p.index} className="flex gap-2">
                <img
                  src={p.image}
                  alt=""
                  className="h-14 w-14 shrink-0 object-cover ring-1 ring-[var(--leaf)]/15"
                />
                <p className="self-center text-sm text-[var(--ink)]">{p.word}</p>
              </li>
            ))}
          </ul>
          {isHost ? (
            <button
              type="button"
              disabled={busy || !peerWho}
              onClick={againGame}
              className="game-btn game-btn-leaf w-full"
            >
              换人再来 · 对方画
            </button>
          ) : (
            <p className="text-center text-sm text-[var(--ink-soft)]">
              等开房的人再来一局
            </p>
          )}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </GameShell>
  )
}
