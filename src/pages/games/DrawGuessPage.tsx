import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GameShell } from '../../components/GameShell'
import { EnterRoomGate } from '../../components/EnterRoomGate'
import { RoomBanner } from '../../components/PeerLobby'
import { randomDrawWord } from '../../lib/drawWords'
import {
  addSavedDrawing,
  canvasToJpeg,
  listSavedDrawings,
  removeSavedDrawing,
  type SavedDrawing,
} from '../../lib/drawGuessStore'
import { leaveGameToHub, withHubNav } from '../../lib/hubNav'
import { usePeerRoom } from '../../lib/PeerRoomContext'
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
import { usePeerSessionGuard } from '../../lib/usePeerSessionGuard'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import {
  savePeerRoom,
  useFlushPeerRoomOnLeave,
} from '../../lib/peerRoomSave'
import { useGamePeerBoot } from '../../lib/useGamePeerBoot'

type Phase = 'lobby' | 'wait' | 'play' | 'done'
type DrawTool = 'pen' | 'eraser'
type ReactVibe = 'up' | 'down'
type DrawCounts = Record<NoteAbout, number>

type Point = { x: number; y: number }
type Stroke = {
  points: Point[]
  color: string
  width?: number
  erase?: boolean
}

type ChatLine = {
  id: string
  at: number
  who: NoteAbout
  kind: 'chat' | 'guess' | 'system' | 'react'
  text: string
  ok?: boolean
  vibe?: ReactVibe
}

type DanmakuItem = {
  id: string
  text: string
  top: number
  kind: 'guess' | 'chat'
  ok?: boolean
  duration: number
}

type Msg =
  | { type: 'hello'; who: NoteAbout }
  | { type: 'role'; drawer: NoteAbout; word: string; draws: DrawCounts }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'clear' }
  | { type: 'hint'; revealed: number[] }
  | { type: 'guess'; id: string; who: NoteAbout; text: string; ok: boolean }
  | { type: 'chat'; id: string; who: NoteAbout; text: string }
  | { type: 'react'; who: NoteAbout; vibe: ReactVibe }
  | { type: 'correct'; who: NoteAbout; word: string }
  | { type: 'next'; drawer: NoteAbout; word: string; draws: DrawCounts }
  | { type: 'finish' }
  | { type: 'again'; drawer: NoteAbout; word: string; draws: DrawCounts }

const PALETTE = [
  '#2a2218',
  '#24543f',
  '#b54a3a',
  '#3b6ea5',
  '#d4a017',
  '#c45a8c',
  '#6b4f2a',
] as const

const PEN_SIZES = [2, 4, 8, 14] as const
const ERASER_SIZES = [10, 18, 28, 40] as const
const DRAWS_EACH = 3
const NEXT_COUNTDOWN = 5
const CANVAS_BG = '#f7f4ee'
const DEFAULT_PEN = 4
const DEFAULT_ERASER = 18

function emptyDraws(): DrawCounts {
  return { her: 0, me: 0 }
}

function pickNextDrawer(prev: NoteAbout, counts: DrawCounts): NoteAbout | null {
  const other = otherAbout(prev)
  if (counts[other] < DRAWS_EACH) return other
  if (counts[prev] < DRAWS_EACH) return prev
  return null
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function maxHintsFor(word: string) {
  return Math.max(1, Math.floor(word.length / 2))
}

function hintMask(word: string, revealed: number[]) {
  return [...word]
    .map((ch, i) => (revealed.includes(i) ? ch : '○'))
    .join('')
}

export function DrawGuessPage() {
  const navigate = useNavigate()
  const room = usePeerRoom()
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [drawer, setDrawer] = useState<NoteAbout | null>(null)
  const [word, setWord] = useState('')
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('')
  const [score, setScore] = useState({ her: 0, me: 0 })
  const [brushColor, setBrushColor] = useState<string>(PALETTE[0])
  const [tool, setTool] = useState<DrawTool>('pen')
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN)
  const [eraserWidth, setEraserWidth] = useState(DEFAULT_ERASER)
  const [hintRevealed, setHintRevealed] = useState<number[]>([])
  const [chat, setChat] = useState<ChatLine[]>([])
  const [reacts, setReacts] = useState<Partial<Record<NoteAbout, ReactVibe>>>({})
  const [saves, setSaves] = useState<SavedDrawing[]>(() => listSavedDrawings())
  const [showRecords, setShowRecords] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [toast, setToast] = useState('')
  const [drawCounts, setDrawCounts] = useState<DrawCounts>(emptyDraws)
  const [roundSolved, setRoundSolved] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [danmaku, setDanmaku] = useState<DanmakuItem[]>([])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const drawing = useRef(false)
  const stroke = useRef<Point[]>([])
  const brushRef = useRef({
    color: PALETTE[0],
    tool: 'pen' as DrawTool,
    penWidth: DEFAULT_PEN,
    eraserWidth: DEFAULT_ERASER,
  })
  const wordRef = useRef('')
  const drawerRef = useRef<NoteAbout | null>(null)
  const drawCountsRef = useRef<DrawCounts>(emptyDraws())
  const roundSolvedRef = useRef(false)
  const hintRevealedRef = useRef<number[]>([])
  const chatIdsRef = useRef(new Set<string>())
  const danmakuLaneRef = useRef(0)
  const danmakuTimers = useRef<number[]>([])
  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  const codeRef = useRef(code)
  const isHostRef = useRef(isHost)
  const leavingHubRef = useRef(false)
  const toastTimer = useRef(0)
  const countdownTimer = useRef(0)
  whoRef.current = who
  codeRef.current = code
  isHostRef.current = isHost
  brushRef.current = { color: brushColor, tool, penWidth, eraserWidth }
  wordRef.current = word
  drawerRef.current = drawer
  drawCountsRef.current = drawCounts
  roundSolvedRef.current = roundSolved
  hintRevealedRef.current = hintRevealed

  const amDrawer = drawer === who
  const hintsLeft = word ? maxHintsFor(word) - hintRevealed.length : 0
  const upCount = Object.values(reacts).filter((v) => v === 'up').length
  const downCount = Object.values(reacts).filter((v) => v === 'down').length
  const myReact = reacts[who]
  const totalDraws = drawCounts.her + drawCounts.me
  const totalSlots = DRAWS_EACH * 2

  usePeerSessionGuard(sessionRef, () => true)

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!code) return null
    return {
      game: 'draw',
      code,
      role: isHost ? 'host' : 'joiner',
      who: whoRef.current,
    }
  })

  const resumeSavedRef = useRef<{ code: string; role: 'host' | 'joiner'; who: NoteAbout } | null>(
    null,
  )

  useGamePeerBoot(
    'draw',
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
      window.clearTimeout(toastTimer.current)
      window.clearInterval(countdownTimer.current)
      for (const id of danmakuTimers.current) window.clearTimeout(id)
    },
    [],
  )

  useEffect(() => {
    if (!showChat) return
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [chat.length, showChat])

  function flash(msg: string) {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }

  function spawnDanmaku(line: ChatLine) {
    if (line.kind !== 'guess' && line.kind !== 'chat') return
    const top = 10 + (danmakuLaneRef.current % 6) * 13
    danmakuLaneRef.current += 1
    const duration = 8 + Math.random() * 2.5
    const item: DanmakuItem = {
      id: `${line.id}-dm`,
      text: `${line.text}${line.ok ? ' ✓' : ''}`,
      top,
      kind: 'guess',
      ok: line.ok,
      duration,
    }
    setDanmaku((rows) => [...rows.slice(-12), item])
    const tid = window.setTimeout(() => {
      setDanmaku((rows) => rows.filter((r) => r.id !== item.id))
    }, duration * 1000 + 200)
    danmakuTimers.current.push(tid)
  }

  function pushChat(line: ChatLine) {
    if (chatIdsRef.current.has(line.id)) return
    chatIdsRef.current.add(line.id)
    setChat((rows) => [...rows, line].slice(-80))
    // 作画时：对方猜测/聊天走弹幕，不挤占画板下方
    if (
      drawerRef.current === whoRef.current &&
      line.who !== whoRef.current &&
      (line.kind === 'guess' || line.kind === 'chat')
    ) {
      spawnDanmaku(line)
    }
  }

  function clearCountdown() {
    window.clearInterval(countdownTimer.current)
    setCountdown(null)
  }

  function adoptLiveFromProvider() {
    const session = room.session
    if (!session) return
    room.bindHandlers(navHandlers(drawHandlers()))
    sessionRef.current = session
    whoRef.current = room.who
    setWho(room.who)
    isHostRef.current = room.isHost
    setIsHost(room.isHost)
    codeRef.current = room.code
    setCode(room.code)
    if (room.peerWho) setPeerWho(room.peerWho)
    setPhase('wait')
    setBusy(false)
    setError('')
    if (session.conn?.open) {
      setError('')
      hello()
    }
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

  // 画板尽量大：优先吃满宽度，高度留给工具条
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || phase !== 'play') return
    const board = canvas.parentElement
    const host = board?.parentElement ?? board
    if (!host) return
    const drawing = drawer === who
    const chrome = drawing ? 250 : 280
    const byWidth = host.clientWidth
    const byHeight = Math.floor(window.innerHeight - chrome)
    const size = Math.max(280, Math.min(byWidth, byHeight, 560))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (board) {
      board.style.width = `${size}px`
    }
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    canvas.width = Math.floor(size * dpr)
    canvas.height = Math.floor(size * dpr)
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = CANVAS_BG
      ctx.fillRect(0, 0, size, size)
    }
  }, [phase, drawer, word, who])

  function send(msg: Msg) {
    sessionRef.current?.send(msg)
  }

  function hello() {
    sessionRef.current?.sendReliable({ type: 'hello', who: whoRef.current })
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    ctx.fillStyle = CANVAS_BG
    ctx.fillRect(0, 0, w, h)
  }

  function drawStroke(s: Stroke) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx || s.points.length < 2) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const erase = !!s.erase
    ctx.save()
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
    if (!erase) ctx.strokeStyle = s.color
    ctx.lineWidth =
      s.width ?? (erase ? brushRef.current.eraserWidth : brushRef.current.penWidth)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(s.points[0].x * w, s.points[0].y * h)
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x * w, s.points[i].y * h)
    }
    ctx.stroke()
    ctx.restore()
  }

  function currentStrokeStyle(): Pick<Stroke, 'color' | 'width' | 'erase'> {
    const { color, tool: t, penWidth: pw, eraserWidth: ew } = brushRef.current
    if (t === 'eraser') {
      return { color: CANVAS_BG, width: ew, erase: true }
    }
    return { color, width: pw, erase: false }
  }

  function startRound(
    nextDrawer: NoteAbout,
    nextWord: string,
    nextDraws: DrawCounts,
  ) {
    clearCountdown()
    setRoundSolved(false)
    setDrawer(nextDrawer)
    setWord(nextWord)
    setDrawCounts(nextDraws)
    setDraft('')
    setHintRevealed([])
    setDanmaku([])
    setTool('pen')
    setReacts({})
    setStatus(
      nextDrawer === whoRef.current
        ? `你来画：${nextWord}`
        : `对方在画，你来猜`,
    )
    setPhase('play')
    pushChat({
      id: newId(),
      at: Date.now(),
      who: nextDrawer,
      kind: 'system',
      text: `第 ${nextDraws.her + nextDraws.me}/${DRAWS_EACH * 2} 幅 · ${aboutLabel(nextDrawer)} 画`,
    })
    requestAnimationFrame(() => clearCanvas())
  }

  function finishGame() {
    clearCountdown()
    setRoundSolved(false)
    setPhase('done')
    setStatus('本局结束')
    pushChat({
      id: newId(),
      at: Date.now(),
      who: whoRef.current,
      kind: 'system',
      text: '本局结束 · 每人已画满三幅',
    })
  }

  function hostAdvance() {
    if (!isHostRef.current) return
    const prev = drawerRef.current
    if (!prev) return
    const counts = drawCountsRef.current
    const next = pickNextDrawer(prev, counts)
    if (!next) {
      send({ type: 'finish' })
      finishGame()
      return
    }
    const nextWord = randomDrawWord(wordRef.current)
    const nextDraws: DrawCounts = {
      ...counts,
      [next]: counts[next] + 1,
    }
    send({ type: 'next', drawer: next, word: nextWord, draws: nextDraws })
    startRound(next, nextWord, nextDraws)
  }

  function beginCountdown() {
    if (roundSolvedRef.current) return
    setRoundSolved(true)
    clearCountdown()
    setCountdown(NEXT_COUNTDOWN)
    let left = NEXT_COUNTDOWN
    countdownTimer.current = window.setInterval(() => {
      left -= 1
      if (left <= 0) {
        clearCountdown()
        hostAdvance()
        return
      }
      setCountdown(left)
    }, 1000)
  }

  function revealHint() {
    const w = wordRef.current
    if (!w) return
    const used = hintRevealedRef.current
    if (used.length >= maxHintsFor(w)) return
    const usedSet = new Set(used)
    const left: number[] = []
    for (let i = 0; i < w.length; i++) {
      if (!usedSet.has(i)) left.push(i)
    }
    if (!left.length) return
    const pick = left[Math.floor(Math.random() * left.length)]
    const next = [...used, pick].sort((a, b) => a - b)
    setHintRevealed(next)
    send({ type: 'hint', revealed: next })
    const mask = hintMask(w, next)
    setStatus(`提示：${mask}`)
    pushChat({
      id: newId(),
      at: Date.now(),
      who: whoRef.current,
      kind: 'system',
      text: `提示 ${mask}`,
    })
  }

  function setReact(vibe: ReactVibe) {
    const me = whoRef.current
    setReacts((r) => ({ ...r, [me]: vibe }))
    send({ type: 'react', who: me, vibe })
    pushChat({
      id: newId(),
      at: Date.now(),
      who: me,
      kind: 'react',
      text: vibe === 'up' ? '点了赞' : '点了踩',
      vibe,
    })
  }

  function saveDrawing() {
    const canvas = canvasRef.current
    if (!canvas || !drawer || !word) return
    try {
      const image = canvasToJpeg(canvas)
      const saved = addSavedDrawing({
        word,
        drawer,
        image,
        ups: upCount,
        downs: downCount,
      })
      setSaves(listSavedDrawings())
      flash('已保存到记录')
      pushChat({
        id: newId(),
        at: Date.now(),
        who: whoRef.current,
        kind: 'system',
        text: `${aboutLabel(whoRef.current)} 保存了这幅「${saved.word}」`,
      })
    } catch {
      flash('保存失败，空间可能不够')
    }
  }

  function deleteSave(id: string) {
    removeSavedDrawing(id)
    setSaves(listSavedDrawings())
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
          sessionRef.current?.sendReliable({ type: 'hello', who: mine })
        }
      }
      return
    }
    if (msg.type === 'role' || msg.type === 'next' || msg.type === 'again') {
      if (msg.type === 'again') setScore({ her: 0, me: 0 })
      const draws =
        msg.draws && typeof msg.draws.her === 'number' && typeof msg.draws.me === 'number'
          ? msg.draws
          : ({ her: 1, me: 0, [msg.drawer]: 1 } as DrawCounts)
      startRound(msg.drawer, msg.word, draws)
      return
    }
    if (msg.type === 'finish') {
      finishGame()
      return
    }
    if (msg.type === 'stroke') {
      drawStroke(msg.stroke)
      return
    }
    if (msg.type === 'clear') {
      clearCanvas()
      return
    }
    if (msg.type === 'hint') {
      const revealed = Array.isArray(msg.revealed) ? msg.revealed : []
      setHintRevealed(revealed)
      const w = wordRef.current
      if (w) {
        const mask = hintMask(w, revealed)
        setStatus(`提示：${mask}`)
        pushChat({
          id: newId(),
          at: Date.now(),
          who: whoRef.current,
          kind: 'system',
          text: `提示 ${mask}`,
        })
      }
      return
    }
    if (msg.type === 'chat') {
      pushChat({
        id: msg.id,
        at: Date.now(),
        who: msg.who,
        kind: 'chat',
        text: msg.text,
      })
      return
    }
    if (msg.type === 'guess') {
      pushChat({
        id: msg.id,
        at: Date.now(),
        who: msg.who,
        kind: 'guess',
        text: msg.text,
        ok: msg.ok,
      })
      setStatus(
        msg.ok
          ? `${aboutLabel(msg.who)} 猜对了：${msg.text}`
          : `${aboutLabel(msg.who)} 猜：${msg.text}`,
      )
      return
    }
    if (msg.type === 'react') {
      setReacts((r) => ({ ...r, [msg.who]: msg.vibe }))
      pushChat({
        id: newId(),
        at: Date.now(),
        who: msg.who,
        kind: 'react',
        text: msg.vibe === 'up' ? '点了赞' : '点了踩',
        vibe: msg.vibe,
      })
      return
    }
    if (msg.type === 'correct') {
      setScore((s) => ({
        ...s,
        [msg.who]: s[msg.who] + 1,
      }))
      setStatus(`${aboutLabel(msg.who)} 猜对了！是「${msg.word}」`)
      pushChat({
        id: newId(),
        at: Date.now(),
        who: msg.who,
        kind: 'system',
        text: `${aboutLabel(msg.who)} 猜对了！是「${msg.word}」`,
      })
      beginCountdown()
    }
  }

  useEffect(() => {
    if (!isHost || !peerWho || phase !== 'wait') return
    const firstDrawer = whoRef.current
    const firstWord = randomDrawWord()
    const firstDraws: DrawCounts = {
      her: firstDrawer === 'her' ? 1 : 0,
      me: firstDrawer === 'me' ? 1 : 0,
    }
    hello()
    sessionRef.current?.sendReliable({
      type: 'role',
      drawer: firstDrawer,
      word: firstWord,
      draws: firstDraws,
    })
    startRound(firstDrawer, firstWord, firstDraws)
  }, [isHost, peerWho, phase])

  function drawHandlers() {
    return {
      onData,
      onOpen: () => {
        setError('')
        hello()
      },
      onDisconnect: () => setError('对方暂时断线了（多半是息屏），正在等他回来…'),
      onClose: () => setError('对方断开了'),
    }
  }

  function navHandlers(handlers: RoomHandlers) {
    return withHubNav(handlers, {
      navigate,
      hereGame: 'draw',
      getMeta: () => ({
        code: codeRef.current || room.code,
        role: isHostRef.current ? 'host' : 'joiner',
        who: whoRef.current,
      }),
      onLocalLeave: () => {
        // 远程跟进不置 leavingHubRef，否则导航失败会卡死「回大厅」
        sessionRef.current = null
      },
    })
  }

  function bindDrawSession(
    session: RoomSession,
    role: 'host' | 'joiner',
    kickOpen: boolean,
  ) {
    sessionRef.current = session
    room.attachSession(session, { who: whoRef.current })
    room.bindHandlers(navHandlers(drawHandlers()))
    isHostRef.current = role === 'host'
    setIsHost(role === 'host')
    codeRef.current = session.code
    setCode(session.code)
    setPhase('wait')
    savePeerRoom({
      game: 'draw',
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
      const handlers = navHandlers(drawHandlers())
      if (existingCode) {
        const live = await adoptParkedSession(existingCode, true, handlers)
        if (live) {
          bindDrawSession(live, 'host', true)
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
      bindDrawSession(session, 'host', false)
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
      const handlers = navHandlers(drawHandlers())
      const live = await adoptParkedSession(roomCode, false, handlers)
      if (live) {
        bindDrawSession(live, 'joiner', true)
        return
      }
      sessionRef.current?.destroy()
      sessionRef.current = null
      await releaseParkedRoom(roomCode)
      const session = await joinPeerRoom(roomCode, handlers)
      bindDrawSession(session, 'joiner', false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加入失败')
    } finally {
      setBusy(false)
    }
  }

  function relPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!amDrawer || roundSolved) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    stroke.current = [relPoint(e)]
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !amDrawer || roundSolved) return
    stroke.current.push(relPoint(e))
    const pts = stroke.current
    if (pts.length < 2) return
    drawStroke({ points: pts.slice(-2), ...currentStrokeStyle() })
  }

  function onPointerUp() {
    if (!drawing.current || !amDrawer) return
    drawing.current = false
    if (stroke.current.length > 1) {
      send({
        type: 'stroke',
        stroke: { points: stroke.current, ...currentStrokeStyle() },
      })
    }
    stroke.current = []
  }

  /** 猜和说同一条：发出去都是弹幕/对话；内容等于答案就算猜中 */
  function submitMessage() {
    if (amDrawer || roundSolved) return
    const text = draft.trim()
    if (!text) return
    const ok = text === word
    const id = newId()
    pushChat({
      id,
      at: Date.now(),
      who,
      kind: 'guess',
      text,
      ok,
    })
    send({ type: 'guess', id, who, text, ok })
    setDraft('')
    if (ok) {
      send({ type: 'correct', who, word })
      setScore((s) => ({ ...s, [who]: s[who] + 1 }))
      setStatus(`猜对了！是「${word}」`)
      pushChat({
        id: newId(),
        at: Date.now(),
        who,
        kind: 'system',
        text: `${aboutLabel(who)} 猜对了！是「${word}」`,
      })
      beginCountdown()
    }
  }

  function skipToNext() {
    if (!isHost || !peerWho || phase !== 'play') return
    clearCountdown()
    hostAdvance()
  }

  function againGame() {
    if (!isHost || !peerWho) return
    const firstDrawer = whoRef.current
    const firstWord = randomDrawWord()
    const firstDraws: DrawCounts = {
      her: firstDrawer === 'her' ? 1 : 0,
      me: firstDrawer === 'me' ? 1 : 0,
    }
    setScore({ her: 0, me: 0 })
    send({
      type: 'again',
      drawer: firstDrawer,
      word: firstWord,
      draws: firstDraws,
    })
    startRound(firstDrawer, firstWord, firstDraws)
  }

  const inMatch = phase === 'play' || phase === 'done'
  const lastChat = chat.length ? chat[chat.length - 1] : null

  return (
    <GameShell
      title="你画我猜"
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
            detail={peerWho ? '对方已到，准备开画' : '等待对方…'}
          />
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            {isHost ? '等对方进来开始' : '已进房，等房主开局…'}
          </p>
        </>
      ) : null}

      {phase === 'done' ? (
        <div className="space-y-3">
          <p className="font-display text-2xl text-[var(--leaf)]">本局结束</p>
          <p className="text-sm text-[var(--ink-soft)]">
            {aboutLabel('her')} {score.her} 分 · {aboutLabel('me')} {score.me} 分 ·
            每人画了 {DRAWS_EACH} 幅
          </p>
          {isHost ? (
            <button
              type="button"
              disabled={busy || !peerWho}
              onClick={againGame}
              className="game-btn game-btn-leaf w-full"
            >
              再来一局
            </button>
          ) : (
            <p className="text-center text-sm text-[var(--ink-soft)]">
              等开房的人再来一局
            </p>
          )}
        </div>
      ) : null}

      {phase === 'play' ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--ink-soft)]">
            <p className="min-w-0 truncate">
              {aboutLabel('her')} {score.her} · {aboutLabel('me')} {score.me} ·{' '}
              {totalDraws}/{totalSlots}幅 · {drawCounts.her}/{DRAWS_EACH}–
              {drawCounts.me}/{DRAWS_EACH}
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setShowChat((v) => !v)}
                className="text-[var(--leaf)]"
              >
                {showChat ? '收对话' : `对话${chat.length ? `(${chat.length})` : ''}`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSaves(listSavedDrawings())
                  setShowRecords((v) => !v)
                }}
                className="text-[var(--leaf)]"
              >
                {showRecords ? '收记录' : '记录'}
              </button>
            </div>
          </div>

          <p className="text-sm leading-snug text-[var(--ink-soft)]">
            {countdown !== null
              ? `猜对了 · ${countdown} 秒后下一幅`
              : status}
          </p>

          {showRecords ? (
            <div className="max-h-40 space-y-2 overflow-y-auto border border-[var(--leaf)]/15 bg-white/50 p-2">
              {saves.length === 0 ? (
                <p className="py-3 text-center text-xs text-[var(--ink-soft)]">
                  还没有保存的画
                </p>
              ) : (
                saves.map((row) => (
                  <div
                    key={row.id}
                    className="flex gap-2 border-b border-[var(--leaf)]/10 pb-2 last:border-0 last:pb-0"
                  >
                    <img
                      src={row.image}
                      alt={row.word}
                      className="h-14 w-14 shrink-0 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[var(--ink)]">{row.word}</p>
                      <p className="text-xs text-[var(--ink-soft)]">
                        {aboutLabel(row.drawer)} · 赞 {row.ups} · 踩 {row.downs}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteSave(row.id)}
                      className="shrink-0 self-start text-xs text-red-700/80"
                    >
                      删
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {amDrawer ? (
            <p className="font-display text-xl text-[var(--leaf)]">题目：{word}</p>
          ) : (
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-display text-lg tracking-[0.3em] text-[var(--ink)]">
                {hintMask(word, hintRevealed)}
              </p>
              <p className="shrink-0 text-xs text-[var(--ink-soft)]">
                {word.length} 字
              </p>
            </div>
          )}

          <div className="draw-board relative mx-auto w-full max-w-full">
            <canvas
              ref={canvasRef}
              className="mx-auto block max-w-full touch-none bg-[#f7f4ee] ring-1 ring-[var(--leaf)]/15"
              style={{
                touchAction: 'none',
                cursor: amDrawer
                  ? tool === 'eraser'
                    ? 'cell'
                    : 'crosshair'
                  : 'default',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {amDrawer && danmaku.length > 0 ? (
              <div className="draw-danmaku-layer" aria-hidden>
                {danmaku.map((item) => (
                  <span
                    key={item.id}
                    className={`draw-danmaku ${
                      item.kind === 'guess'
                        ? item.ok
                          ? 'is-ok'
                          : 'is-guess'
                        : 'is-chat'
                    }`}
                    style={{
                      top: `${item.top}%`,
                      animationDuration: `${item.duration}s`,
                    }}
                  >
                    {item.text}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setReact('up')}
              className={`min-h-9 px-2.5 text-sm ${
                myReact === 'up'
                  ? 'bg-[var(--leaf)] text-[var(--foam)]'
                  : 'border border-[var(--leaf)]/25 text-[var(--ink-soft)]'
              }`}
            >
              赞 {upCount}
            </button>
            <button
              type="button"
              onClick={() => setReact('down')}
              className={`min-h-9 px-2.5 text-sm ${
                myReact === 'down'
                  ? 'bg-[var(--cork-ink)] text-[var(--foam)]'
                  : 'border border-[var(--leaf)]/25 text-[var(--ink-soft)]'
              }`}
            >
              踩 {downCount}
            </button>
            <button
              type="button"
              onClick={saveDrawing}
              className="min-h-9 border border-[var(--leaf)]/25 px-2.5 text-sm text-[var(--ink-soft)]"
            >
              保存
            </button>
            {toast ? <span className="text-xs text-[var(--leaf)]">{toast}</span> : null}
          </div>

          {amDrawer ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`颜色 ${c}`}
                    onClick={() => {
                      setBrushColor(c)
                      setTool('pen')
                    }}
                    className="h-7 w-7 shrink-0 rounded-full"
                    style={{
                      background: c,
                      boxShadow:
                        tool === 'pen' && brushColor === c
                          ? '0 0 0 2px var(--leaf)'
                          : 'inset 0 0 0 1px rgba(0,0,0,0.12)',
                    }}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setTool('eraser')}
                  className={`min-h-7 shrink-0 px-2 text-xs ${
                    tool === 'eraser'
                      ? 'bg-[var(--cork-ink)] text-[var(--foam)]'
                      : 'border border-[var(--leaf)]/25 text-[var(--ink-soft)]'
                  }`}
                >
                  橡皮
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-[var(--ink-soft)]">
                  {tool === 'eraser' ? '橡皮粗细' : '笔粗细'}
                </span>
                {(tool === 'eraser' ? ERASER_SIZES : PEN_SIZES).map((w) => {
                  const on = tool === 'eraser' ? eraserWidth === w : penWidth === w
                  return (
                    <button
                      key={w}
                      type="button"
                      onClick={() => {
                        if (tool === 'eraser') setEraserWidth(w)
                        else setPenWidth(w)
                      }}
                      className={`inline-flex h-8 w-8 items-center justify-center ${
                        on
                          ? 'bg-[var(--leaf)]/15 ring-1 ring-[var(--leaf)]'
                          : 'border border-[var(--leaf)]/20'
                      }`}
                      aria-label={`粗细 ${w}`}
                    >
                      <span
                        className="rounded-full bg-[var(--ink)]"
                        style={{
                          width: Math.min(18, w + 2),
                          height: Math.min(18, w + 2),
                        }}
                      />
                    </button>
                  )
                })}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={revealHint}
                  disabled={hintsLeft <= 0 || roundSolved}
                  className="min-h-10 flex-1 border border-[var(--leaf)]/25 text-sm text-[var(--ink-soft)] disabled:opacity-40"
                >
                  提示{hintsLeft > 0 ? ` ${hintsLeft}` : ' 完'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearCanvas()
                    send({ type: 'clear' })
                  }}
                  disabled={roundSolved}
                  className="min-h-10 flex-1 border border-[var(--leaf)]/25 text-sm text-[var(--ink-soft)] disabled:opacity-40"
                >
                  清空
                </button>
              </div>
            </div>
          ) : null}

          {!amDrawer ? (
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="说一句，对了就算猜中"
                disabled={roundSolved}
                className="min-h-10 min-w-0 flex-1 bg-white/70 px-3 text-base outline-none ring-1 ring-[var(--leaf)]/20 disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitMessage()
                }}
              />
              <button
                type="button"
                onClick={submitMessage}
                disabled={roundSolved}
                className="min-h-10 shrink-0 bg-[var(--leaf)] px-4 text-[var(--foam)] disabled:opacity-50"
              >
                发送
              </button>
              <button
                type="button"
                onClick={revealHint}
                disabled={hintsLeft <= 0 || roundSolved}
                className="min-h-10 shrink-0 border border-[var(--leaf)]/25 px-3 text-sm text-[var(--ink-soft)] disabled:opacity-40"
              >
                提示
              </button>
            </div>
          ) : null}

          {showChat ? (
            <div className="max-h-28 space-y-1 overflow-y-auto border border-[var(--leaf)]/15 bg-white/40 p-2">
              {chat.length === 0 ? (
                <p className="py-2 text-center text-xs text-[var(--ink-soft)]">
                  还没有记录
                </p>
              ) : (
                chat.map((line) => (
                  <p
                    key={line.id}
                    className={`text-sm leading-snug ${
                      line.kind === 'system' || line.kind === 'react'
                        ? 'text-[var(--ink-soft)]'
                        : line.ok
                          ? 'text-[var(--leaf)]'
                          : 'text-[var(--ink)]'
                    }`}
                  >
                    {line.kind === 'system' ? (
                      line.text
                    ) : line.kind === 'react' ? (
                      <>
                        {aboutLabel(line.who)} {line.text}
                      </>
                    ) : (
                      <>
                        <span className="text-[var(--ink-soft)]">
                          {aboutLabel(line.who)}：
                        </span>
                        {line.text}
                        {line.ok ? ' ✓' : ''}
                      </>
                    )}
                  </p>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
          ) : lastChat && !amDrawer ? (
            <p className="truncate text-xs text-[var(--ink-soft)]">
              {lastChat.kind === 'system' || lastChat.kind === 'react'
                ? lastChat.text
                : `${aboutLabel(lastChat.who)}：${lastChat.text}${lastChat.ok ? ' ✓' : ''}`}
            </p>
          ) : null}

          {isHost ? (
            <button
              type="button"
              disabled={busy || !peerWho}
              onClick={skipToNext}
              className="min-h-9 w-full border border-[var(--leaf)]/25 text-sm text-[var(--ink-soft)]"
            >
              {countdown !== null ? '立刻下一幅' : '跳过 · 下一幅'}
            </button>
          ) : (
            <p className="text-center text-xs text-[var(--ink-soft)]">
              猜对后自动下一幅
            </p>
          )}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </GameShell>
  )
}
