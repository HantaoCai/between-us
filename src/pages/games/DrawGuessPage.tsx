import { useEffect, useRef, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { PeerLobby, RoomBanner } from '../../components/PeerLobby'
import { randomDrawWord } from '../../lib/drawWords'
import {
  createPeerRoom,
  joinPeerRoom,
  type RoomSession,
} from '../../lib/peerRoom'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import {
  savePeerRoom,
  useFlushPeerRoomOnLeave,
} from '../../lib/peerRoomSave'
import { useConfirmLeaveGame } from '../../lib/useConfirmLeaveGame'
import { useResumePeerRoom } from '../../lib/useResumePeerRoom'

type Phase = 'lobby' | 'wait' | 'play'

type Point = { x: number; y: number }
type Stroke = { points: Point[]; color: string }

type Msg =
  | { type: 'hello'; who: NoteAbout }
  | { type: 'role'; drawer: NoteAbout; word: string }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'clear' }
  | { type: 'guess'; text: string }
  | { type: 'correct'; who: NoteAbout; word: string }
  | { type: 'next'; drawer: NoteAbout; word: string }

export function DrawGuessPage() {
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [drawer, setDrawer] = useState<NoteAbout | null>(null)
  const [word, setWord] = useState('')
  const [guess, setGuess] = useState('')
  const [status, setStatus] = useState('')
  const [score, setScore] = useState({ her: 0, me: 0 })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const stroke = useRef<Point[]>([])
  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  whoRef.current = who

  const amDrawer = drawer === who

  useConfirmLeaveGame(phase !== 'lobby')

  useEffect(() => () => sessionRef.current?.destroy(), [])

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!code) return null
    return {
      game: 'draw',
      code,
      role: isHost ? 'host' : 'joiner',
      who: whoRef.current,
    }
  })

  useResumePeerRoom('draw', (saved) => {
    setBusy(true)
    setError('')
    whoRef.current = saved.who
    setWho(saved.who)
    if (saved.role === 'host') void create(saved.code)
    else void join(saved.code)
  })

  // 手机宽度自适应画布像素，避免糊/点不准
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || phase !== 'play') return
    const parent = canvas.parentElement
    if (!parent) return
    const size = Math.min(parent.clientWidth, 420)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    canvas.width = Math.floor(size * dpr)
    canvas.height = Math.floor(size * dpr)
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#f7f4ee'
      ctx.fillRect(0, 0, size, size)
    }
  }, [phase, drawer, word])

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
    ctx.fillStyle = '#f7f4ee'
    ctx.fillRect(0, 0, w, h)
  }

  function drawStroke(s: Stroke) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx || s.points.length < 2) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    ctx.strokeStyle = s.color
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(s.points[0].x * w, s.points[0].y * h)
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x * w, s.points[i].y * h)
    }
    ctx.stroke()
  }

  function startRound(nextDrawer: NoteAbout, nextWord: string) {
    setDrawer(nextDrawer)
    setWord(nextWord)
    setGuess('')
    setStatus(
      nextDrawer === whoRef.current
        ? `你来画：${nextWord}`
        : `对方在画，你来猜`,
    )
    setPhase('play')
    requestAnimationFrame(() => clearCanvas())
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
    if (msg.type === 'role' || msg.type === 'next') {
      startRound(msg.drawer, msg.word)
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
    if (msg.type === 'guess') {
      setStatus(`对方猜：${msg.text}`)
      return
    }
    if (msg.type === 'correct') {
      setScore((s) => ({
        ...s,
        [msg.who]: s[msg.who] + 1,
      }))
      setStatus(`${aboutLabel(msg.who)} 猜对了！是「${msg.word}」`)
    }
  }

  useEffect(() => {
    if (!isHost || !peerWho || phase !== 'wait') return
    const firstDrawer = whoRef.current
    const firstWord = randomDrawWord()
    hello()
    sessionRef.current?.sendReliable({
      type: 'role',
      drawer: firstDrawer,
      word: firstWord,
    })
    startRound(firstDrawer, firstWord)
  }, [isHost, peerWho, phase])

  async function create(existingCode?: string) {
    setBusy(true)
    setError('')
    try {
      sessionRef.current?.destroy()
      const session = await createPeerRoom(
        {
          onData,
          onOpen: () => {
            setError('')
            hello()
          },
          onDisconnect: () => setError('连接不稳，正在重连…'),
          onClose: () => setError('对方断开了'),
        },
        existingCode ? { code: existingCode } : undefined,
      )
      sessionRef.current = session
      setIsHost(true)
      setCode(session.code)
      setPhase('wait')
      savePeerRoom({
        game: 'draw',
        code: session.code,
        role: 'host',
        who: whoRef.current,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '开房失败')
    } finally {
      setBusy(false)
    }
  }

  async function join(room: string) {
    setBusy(true)
    setError('')
    try {
      sessionRef.current?.destroy()
      const session = await joinPeerRoom(room, {
        onData,
        onOpen: () => {
          setError('')
          hello()
        },
        onDisconnect: () => setError('连接不稳，正在重连…'),
        onClose: () => setError('对方断开了'),
      })
      sessionRef.current = session
      setIsHost(false)
      setCode(session.code)
      setPhase('wait')
      savePeerRoom({
        game: 'draw',
        code: session.code,
        role: 'joiner',
        who: whoRef.current,
      })
      hello()
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
    if (!amDrawer) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    stroke.current = [relPoint(e)]
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !amDrawer) return
    stroke.current.push(relPoint(e))
    const pts = stroke.current
    if (pts.length < 2) return
    drawStroke({ points: pts.slice(-2), color: '#2a2218' })
  }

  function onPointerUp() {
    if (!drawing.current || !amDrawer) return
    drawing.current = false
    if (stroke.current.length > 1) {
      send({ type: 'stroke', stroke: { points: stroke.current, color: '#2a2218' } })
    }
    stroke.current = []
  }

  function submitGuess() {
    const text = guess.trim()
    if (!text || amDrawer) return
    send({ type: 'guess', text })
    if (text === word) {
      send({ type: 'correct', who, word })
      setScore((s) => ({ ...s, [who]: s[who] + 1 }))
      setStatus(`猜对了！是「${word}」`)
    } else {
      setStatus(`不对：${text}`)
    }
  }

  function nextRound() {
    if (!isHost || !peerWho) return
    const nextDrawer = drawer === 'her' ? 'me' : 'her'
    const nextWord = randomDrawWord(word)
    send({ type: 'next', drawer: nextDrawer, word: nextWord })
    startRound(nextDrawer, nextWord)
  }

  return (
    <GameShell title="你画我猜">
      {phase === 'lobby' ? (
        <PeerLobby
          busy={busy}
          error={error}
          who={who}
          onWho={setWho}
          onCreate={() => void create()}
          onJoin={(c) => void join(c)}
        />
      ) : (
        <>
          <RoomBanner
            code={code}
            detail={
              peerWho
                ? `${aboutLabel('her')} ${score.her} · ${aboutLabel('me')} ${score.me}`
                : '等待对方…'
            }
          />

          {phase === 'wait' ? (
            <p className="text-sm text-[var(--ink-soft)]">
              {isHost ? '等对方进来开始' : '已进房，等房主开局…'}
            </p>
          ) : null}

          {phase === 'play' ? (
            <div className="space-y-3">
              <p className="text-sm text-[var(--ink-soft)]">{status}</p>
              {amDrawer ? (
                <p className="font-display text-2xl text-[var(--leaf)]">题目：{word}</p>
              ) : (
                <p className="text-sm text-[var(--ink-soft)]">
                  {drawer ? `${aboutLabel(drawer)} 正在画` : '…'}
                </p>
              )}

              <canvas
                ref={canvasRef}
                className="mx-auto block max-w-full touch-none bg-[#f7f4ee] ring-1 ring-[var(--leaf)]/15"
                style={{ touchAction: 'none' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />

              {amDrawer ? (
                <button
                  type="button"
                  onClick={() => {
                    clearCanvas()
                    send({ type: 'clear' })
                  }}
                  className="min-h-12 w-full border border-[var(--leaf)]/25 text-sm text-[var(--ink-soft)]"
                >
                  清空画布
                </button>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                    placeholder="输入你的猜测"
                    className="min-h-12 min-w-0 flex-1 bg-white/70 px-3 text-base outline-none ring-1 ring-[var(--leaf)]/20"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitGuess()
                    }}
                  />
                  <button
                    type="button"
                    onClick={submitGuess}
                    className="min-h-12 shrink-0 bg-[var(--leaf)] px-5 text-[var(--foam)]"
                  >
                    猜
                  </button>
                </div>
              )}

              {isHost ? (
                <button
                  type="button"
                  onClick={nextRound}
                  className="min-h-12 w-full bg-[var(--cork-ink)] text-sm text-[var(--foam)]"
                >
                  下一轮（换人画）
                </button>
              ) : (
                <p className="text-center text-xs text-[var(--ink-soft)]">房主可切下一轮</p>
              )}
            </div>
          ) : null}

          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        </>
      )}
    </GameShell>
  )
}
