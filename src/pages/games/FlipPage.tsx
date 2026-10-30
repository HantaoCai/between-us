import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnterRoomGate } from '../../components/EnterRoomGate'
import { GameShell } from '../../components/GameShell'
import { RoomBanner } from '../../components/PeerLobby'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import {
  createPeerRoom,
  joinPeerRoom,
  type RoomSession,
} from '../../lib/peerRoom'
import { returnToGameHub } from '../../lib/hubReturn'
import {
  clearPeerRoom,
  savePeerRoom,
  useFlushPeerRoomOnLeave,
} from '../../lib/peerRoomSave'
import { useResumePeerRoom } from '../../lib/useResumePeerRoom'

const RULE = '同一副牌，轮流翻两张。配上了就留着，没配上就盖回去并换人。全部配对，这局一起过关。'
const ICONS = ['☕', '🌧️', '🌙', '🍃', '📷', '🍜']

type Phase = 'lobby' | 'table'
type Card = { icon: string; matched: boolean }

type SyncMsg = {
  type: 'sync'
  seq: number
  icons: string[]
  matched: boolean[]
  open: number[]
  turn: NoteAbout
  moves: number
  lock: boolean
}

type Msg =
  | { type: 'hello'; who: NoteAbout }
  | { type: 'need-start' }
  | SyncMsg
  | { type: 'flip'; seq: number; index: number; by: NoteAbout }
  | { type: 'close'; seq: number }

function shuffle<T>(list: T[]): T[] {
  const next = [...list]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function buildIcons() {
  return shuffle(ICONS.flatMap((icon) => [icon, icon]))
}

function isAbout(value: unknown): value is NoteAbout {
  return value === 'her' || value === 'me'
}

function isSync(raw: Msg): raw is SyncMsg {
  if (raw.type !== 'sync') return false
  const msg = raw as SyncMsg
  if (!Number.isInteger(msg.seq) || msg.seq < 1) return false
  if (!Array.isArray(msg.icons) || msg.icons.length !== 12) return false
  if (!msg.icons.every((icon) => typeof icon === 'string' && icon.length > 0 && icon.length < 8)) {
    return false
  }
  if (!Array.isArray(msg.matched) || msg.matched.length !== 12) return false
  if (!msg.matched.every((flag) => typeof flag === 'boolean')) return false
  if (!Array.isArray(msg.open) || msg.open.length > 2) return false
  if (!msg.open.every((index) => Number.isInteger(index) && index >= 0 && index < 12)) return false
  if (!isAbout(msg.turn)) return false
  if (!Number.isInteger(msg.moves) || msg.moves < 0 || msg.moves > 80) return false
  return typeof msg.lock === 'boolean'
}

export function FlipPage() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [code, setCode] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deck, setDeck] = useState<Card[]>([])
  const [open, setOpen] = useState<number[]>([])
  const [turn, setTurn] = useState<NoteAbout>('her')
  const [moves, setMoves] = useState(0)
  const [lock, setLock] = useState(false)
  const [done, setDone] = useState(false)

  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  const peerWhoRef = useRef<NoteAbout | null>(null)
  const codeRef = useRef('')
  const isHostRef = useRef(false)
  const deckRef = useRef<Card[]>([])
  const openRef = useRef<number[]>([])
  const turnRef = useRef<NoteAbout>('her')
  const movesRef = useRef(0)
  const lockRef = useRef(false)
  const doneRef = useRef(false)
  const seqRef = useRef(0)
  const firstRef = useRef<NoteAbout>('her')
  const closeTimer = useRef(0)
  const closeArmed = useRef(false)

  whoRef.current = who
  peerWhoRef.current = peerWho
  codeRef.current = code
  isHostRef.current = isHost

  const leavingHubRef = useRef(false)

  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current)
      if (leavingHubRef.current) return
      sessionRef.current?.destroy()
      sessionRef.current = null
    },
    [],
  )

  useEffect(() => {
    if (isHost || phase !== 'table' || deck.length > 0) return
    const tick = () => {
      sessionRef.current?.sendReliable({ type: 'hello', who: whoRef.current })
      sessionRef.current?.sendReliable({ type: 'need-start' })
    }
    tick()
    const id = window.setInterval(tick, 1600)
    return () => window.clearInterval(id)
  }, [isHost, phase, deck.length])

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!codeRef.current) return null
    return {
      game: 'flip',
      code: codeRef.current,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
    }
  })

  const resumeSavedRef = useRef<{
    code: string
    role: 'host' | 'joiner'
    who: NoteAbout
  } | null>(null)

  useResumePeerRoom('flip', (saved) => {
    resumeSavedRef.current = { code: saved.code, role: saved.role, who: saved.who }
    setBusy(true)
    setError('')
    whoRef.current = saved.who
    setWho(saved.who)
    if (saved.role === 'host') void create(saved.code)
    else void join(saved.code)
  })

  function buildSync(): SyncMsg {
    return {
      type: 'sync',
      seq: seqRef.current,
      icons: deckRef.current.map((card) => card.icon),
      matched: deckRef.current.map((card) => card.matched),
      open: openRef.current,
      turn: turnRef.current,
      moves: movesRef.current,
      lock: lockRef.current,
    }
  }

  function ensureCloseTimer() {
    if (!lockRef.current || turnRef.current !== whoRef.current || closeArmed.current) return
    closeArmed.current = true
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      closeArmed.current = false
      const seq = seqRef.current
      sessionRef.current?.sendReliable({ type: 'close', seq })
      applyClose(seq)
    }, 700)
  }

  function applyClose(seq: number) {
    if (seq !== seqRef.current || !lockRef.current) return
    window.clearTimeout(closeTimer.current)
    closeArmed.current = false
    lockRef.current = false
    setLock(false)
    openRef.current = []
    setOpen([])
    const next = otherAbout(turnRef.current)
    turnRef.current = next
    setTurn(next)
  }

  function applyFlip(index: number, by: NoteAbout): boolean {
    if (doneRef.current || lockRef.current) return false
    if (turnRef.current !== by) return false
    const deckNow = deckRef.current
    const card = deckNow[index]
    if (!card || card.matched || openRef.current.includes(index)) return false
    const nextOpen = [...openRef.current, index]
    openRef.current = nextOpen
    setOpen(nextOpen)
    if (nextOpen.length < 2) return true

    const nextMoves = movesRef.current + 1
    movesRef.current = nextMoves
    setMoves(nextMoves)
    const [a, b] = nextOpen
    if (deckNow[a].icon === deckNow[b].icon) {
      const nextDeck = deckNow.map((item, i) =>
        i === a || i === b ? { ...item, matched: true } : item,
      )
      deckRef.current = nextDeck
      setDeck(nextDeck)
      openRef.current = []
      setOpen([])
      const finished = nextDeck.every((item) => item.matched)
      doneRef.current = finished
      setDone(finished)
      if (!finished) {
        const nextTurn = otherAbout(by)
        turnRef.current = nextTurn
        setTurn(nextTurn)
      }
      return true
    }

    lockRef.current = true
    setLock(true)
    if (by === whoRef.current) ensureCloseTimer()
    return true
  }

  function applySync(msg: SyncMsg) {
    if (deckRef.current.length > 0 && msg.seq <= seqRef.current) return
    window.clearTimeout(closeTimer.current)
    closeArmed.current = false
    seqRef.current = msg.seq
    const nextDeck = msg.icons.map((icon, index) => ({
      icon,
      matched: msg.matched[index] === true,
    }))
    deckRef.current = nextDeck
    setDeck(nextDeck)
    const nextOpen = msg.lock && msg.open.length === 2 ? msg.open : msg.lock ? [] : msg.open
    openRef.current = nextOpen
    setOpen(nextOpen)
    turnRef.current = msg.turn
    setTurn(msg.turn)
    movesRef.current = msg.moves
    setMoves(msg.moves)
    const locked = msg.lock && nextOpen.length === 2
    lockRef.current = locked
    setLock(locked)
    const finished = nextDeck.every((card) => card.matched)
    doneRef.current = finished
    setDone(finished)
    if (locked) ensureCloseTimer()
  }

  function deal(icons: string[], first: NoteAbout) {
    window.clearTimeout(closeTimer.current)
    closeArmed.current = false
    seqRef.current += 1
    firstRef.current = first
    const nextDeck = icons.map((icon) => ({ icon, matched: false }))
    deckRef.current = nextDeck
    setDeck(nextDeck)
    openRef.current = []
    setOpen([])
    turnRef.current = first
    setTurn(first)
    movesRef.current = 0
    setMoves(0)
    lockRef.current = false
    setLock(false)
    doneRef.current = false
    setDone(false)
    sessionRef.current?.sendReliable(buildSync())
  }

  function ensureDeal() {
    if (!sessionRef.current?.isHost) return
    if (seqRef.current === 0) {
      deal(buildIcons(), whoRef.current)
      return
    }
    sessionRef.current.sendReliable(buildSync())
  }

  function hello() {
    sessionRef.current?.sendReliable({ type: 'hello', who: whoRef.current })
  }

  function onData(raw: unknown) {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return
    const msg = raw as Msg
    if (msg.type === 'hello') {
      if (!isAbout(msg.who)) return
      peerWhoRef.current = msg.who
      setPeerWho(msg.who)
      if (!sessionRef.current?.isHost) {
        const mine = otherAbout(msg.who)
        if (whoRef.current !== mine) {
          whoRef.current = mine
          setWho(mine)
          hello()
        }
      } else {
        ensureDeal()
      }
      return
    }
    if (msg.type === 'need-start') {
      ensureDeal()
      return
    }
    if (msg.type === 'sync') {
      if (sessionRef.current?.isHost || !isSync(msg)) return
      applySync(msg)
      return
    }
    if (msg.type === 'flip') {
      if (msg.seq !== seqRef.current || !isAbout(msg.by)) return
      if (!Number.isInteger(msg.index)) return
      applyFlip(msg.index, msg.by)
      return
    }
    if (msg.type === 'close') {
      if (!Number.isInteger(msg.seq)) return
      applyClose(msg.seq)
    }
  }

  function onRoomOpen() {
    setError('')
    hello()
    if (!sessionRef.current?.isHost) {
      sessionRef.current?.sendReliable({ type: 'need-start' })
      return
    }
    if (peerWhoRef.current) ensureDeal()
  }

  async function create(existingCode?: string) {
    setBusy(true)
    setError('')
    try {
      sessionRef.current?.destroy()
      const session = await createPeerRoom(
        {
          onData,
          onOpen: onRoomOpen,
          onWake: () => {
            hello()
            if (seqRef.current > 0) sessionRef.current?.sendReliable(buildSync())
          },
          onDisconnect: () => setError('连接不稳，正在重连…'),
          onClose: () => setError('对方断开了'),
        },
        existingCode ? { code: existingCode } : undefined,
      )
      sessionRef.current = session
      isHostRef.current = true
      setIsHost(true)
      codeRef.current = session.code
      setCode(session.code)
      setPhase('table')
      savePeerRoom({
        game: 'flip',
        code: session.code,
        role: 'host',
        who: whoRef.current,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '开房失败')
      setPhase('lobby')
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
        onOpen: onRoomOpen,
        onWake: () => {
          hello()
          if (deckRef.current.length === 0) {
            sessionRef.current?.sendReliable({ type: 'need-start' })
          }
        },
        onDisconnect: () => setError('连接不稳，正在重连…'),
        onClose: () => setError('对方断开了'),
      })
      sessionRef.current = session
      isHostRef.current = false
      setIsHost(false)
      codeRef.current = session.code
      setCode(session.code)
      setPhase('table')
      savePeerRoom({
        game: 'flip',
        code: session.code,
        role: 'joiner',
        who: whoRef.current,
      })
      hello()
      session.sendReliable({ type: 'need-start' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '加入失败')
      setPhase('lobby')
    } finally {
      setBusy(false)
    }
  }

  function retryResume() {
    const saved = resumeSavedRef.current
    if (!saved) return
    whoRef.current = saved.who
    setWho(saved.who)
    if (saved.role === 'host') void create(saved.code)
    else void join(saved.code)
  }

  function flip(index: number) {
    if (turnRef.current !== whoRef.current) return
    if (!applyFlip(index, whoRef.current)) return
    sessionRef.current?.sendReliable({
      type: 'flip',
      seq: seqRef.current,
      index,
      by: whoRef.current,
    })
  }

  function rematch() {
    if (!sessionRef.current?.isHost) return
    const first = otherAbout(firstRef.current)
    deal(buildIcons(), first)
  }

  async function leaveRoom() {
    if (leavingHubRef.current) return
    leavingHubRef.current = true
    const roomCode = codeRef.current
    const role = isHostRef.current ? 'host' : 'joiner'
    const me = whoRef.current
    const session = sessionRef.current
    sessionRef.current = null
    peerWhoRef.current = null
    setPeerWho(null)
    if (!roomCode) {
      clearPeerRoom('flip')
      navigate('/games', { replace: true })
      return
    }
    setBusy(true)
    await returnToGameHub({
      session,
      code: roomCode,
      role,
      who: me,
      navigate,
    })
  }

  const peerName = peerWho ? aboutLabel(peerWho) : '对方'
  const mine = turn === who

  return (
    <GameShell title="翻翻乐" blurb={RULE} compact={phase !== 'lobby' && deck.length > 0}>
      {phase === 'lobby' ? (
        <EnterRoomGate
          busy={busy}
          status={busy ? '正在回到房间…' : undefined}
          error={busy ? undefined : error}
          onRetry={resumeSavedRef.current ? () => retryResume() : undefined}
        />
      ) : deck.length === 0 ? (
        <div className="space-y-4">
          <RoomBanner
            code={code}
            detail={
              peerWho
                ? `${aboutLabel(who)} · ${peerName}`
                : `你是${aboutLabel(who)} · 等对方`
            }
          />
          <p className="text-sm text-[var(--ink-soft)]">
            {peerWho ? (isHost ? '正在发牌…' : '等开房的人发牌…') : '等对方进房后一起翻'}
          </p>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <button
            type="button"
            className="game-btn game-btn-ghost w-full"
            disabled={busy}
            onClick={() => void leaveRoom()}
          >
            回大厅
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-[var(--ink)]">
              {done ? '一起翻完了' : mine ? '轮到你，翻开两张' : `轮到${aboutLabel(turn)}`}
            </p>
            <p className="text-xs tracking-[0.12em] text-[var(--ink-soft)]">
              {done ? `用了 ${moves} 步` : `一起 ${moves} 步`}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {deck.map((card, index) => {
              const shown = card.matched || open.includes(index)
              return (
                <button
                  key={index}
                  type="button"
                  disabled={done || lock || !mine || card.matched || open.includes(index)}
                  onClick={() => flip(index)}
                  className={[
                    'game-flip-tile',
                    shown ? 'is-face' : 'is-back',
                    card.matched ? 'is-matched' : '',
                    !mine && !shown ? 'is-dim' : '',
                  ].join(' ')}
                >
                  {shown ? card.icon : '?'}
                </button>
              )
            })}
          </div>

          {done ? (
            isHost ? (
              <button type="button" className="game-btn game-btn-leaf w-full" onClick={rematch}>
                再来一局
              </button>
            ) : (
              <p className="text-center text-sm text-[var(--ink-soft)]">等开房的人再来一局</p>
            )
          ) : null}

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <button
            type="button"
            className="game-btn game-btn-ghost w-full"
            disabled={busy}
            onClick={() => void leaveRoom()}
          >
            回大厅
          </button>
        </div>
      )}
    </GameShell>
  )
}
