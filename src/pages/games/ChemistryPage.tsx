import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnterRoomGate } from '../../components/EnterRoomGate'
import { GameShell } from '../../components/GameShell'
import { RoomBanner } from '../../components/PeerLobby'
import {
  buildChemistryMatch,
  CHEMISTRY_ROUNDS,
  chemistrySyncLabel,
  isChemistryItem,
  type ChemistryItem,
  type ChemistryRounds,
} from '../../lib/chemistry'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import {
  getHubNavEpoch,
  leaveGameToHub,
  withHubNav,
} from '../../lib/hubNav'
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
import {
  clearPeerRoom,
  savePeerRoom,
  useFlushPeerRoomOnLeave,
} from '../../lib/peerRoomSave'
import { useGamePeerBoot } from '../../lib/useGamePeerBoot'
import { usePeerSessionGuard } from '../../lib/usePeerSessionGuard'

const RULE =
  '同一题各自选一个答案，选完先保密。两边都选好后揭晓：一样算合拍。比的是默契，不是输赢。'

type Phase = 'lobby' | 'wait' | 'play' | 'done'

type Msg =
  | { type: 'hello'; who: NoteAbout }
  | { type: 'ready' }
  | { type: 'need-start' }
  | { type: 'start'; items: ChemistryItem[]; seq?: number }
  | { type: 'answer'; index: number; choice: number }

export function ChemistryPage() {
  const navigate = useNavigate()
  const room = usePeerRoom()
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rounds, setRounds] = useState<ChemistryRounds>(8)
  const [items, setItems] = useState<ChemistryItem[]>([])
  const [index, setIndex] = useState(0)
  const [myAnswers, setMyAnswers] = useState<(number | null)[]>([])
  const [peerAnswers, setPeerAnswers] = useState<(number | null)[]>([])
  const [isHost, setIsHost] = useState(false)
  const [peerReady, setPeerReady] = useState(false)
  const [revealing, setRevealing] = useState(false)

  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  const itemsRef = useRef<ChemistryItem[]>([])
  const myAnswersRef = useRef<(number | null)[]>([])
  const peerAnswersRef = useRef<(number | null)[]>([])
  const indexRef = useRef(0)
  const roundsRef = useRef(rounds)
  const pendingStartRef = useRef<{ items: ChemistryItem[]; seq: number } | null>(
    null,
  )
  const startSeqRef = useRef(0)
  const seenSeqRef = useRef(0)
  const revealTimer = useRef(0)
  const revealingRef = useRef(false)

  whoRef.current = who
  itemsRef.current = items
  myAnswersRef.current = myAnswers
  peerAnswersRef.current = peerAnswers
  indexRef.current = index
  roundsRef.current = rounds
  revealingRef.current = revealing

  const codeRef = useRef(code)
  const isHostRef = useRef(isHost)
  const leavingHubRef = useRef(false)
  codeRef.current = code
  isHostRef.current = isHost

  usePeerSessionGuard(sessionRef, () => true)
  useEffect(() => () => window.clearTimeout(revealTimer.current), [])

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!code) return null
    return {
      game: 'chemistry',
      code,
      role: isHost ? 'host' : 'joiner',
      who: whoRef.current,
    }
  })

  const resumeSavedRef = useRef<{
    code: string
    role: 'host' | 'joiner'
    who: NoteAbout
  } | null>(null)

  useGamePeerBoot(
    'chemistry',
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

  function adoptLiveFromProvider() {
    const session = room.session
    if (!session) return
    room.bindHandlers(navHandlers(chemistryHandlers()))
    sessionRef.current = session
    whoRef.current = room.who
    setWho(room.who)
    isHostRef.current = room.isHost
    setIsHost(room.isHost)
    if (room.isHost) setPeerReady(false)
    codeRef.current = room.code
    setCode(room.code)
    if (room.peerWho) setPeerWho(room.peerWho)
    setPhase('wait')
    setBusy(false)
    setError('')
    if (session.conn?.open) onRoomOpen()
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

  const total = items.length
  const current = items[index]
  const myPick = myAnswers[index] ?? null
  const peerPick = peerAnswers[index] ?? null
  const matched = useMemo(() => {
    let n = 0
    for (let i = 0; i < items.length; i++) {
      const a = myAnswers[i]
      const b = peerAnswers[i]
      if (a != null && b != null && a === b) n += 1
    }
    return n
  }, [items, myAnswers, peerAnswers])

  function hello() {
    sessionRef.current?.sendReliable({ type: 'hello', who: whoRef.current })
  }

  function beginMatch(nextItems: ChemistryItem[]) {
    window.clearTimeout(revealTimer.current)
    setItems(nextItems)
    itemsRef.current = nextItems
    setRounds(
      (CHEMISTRY_ROUNDS.includes(nextItems.length as ChemistryRounds)
        ? nextItems.length
        : 8) as ChemistryRounds,
    )
    roundsRef.current = nextItems.length as ChemistryRounds
    const empty = Array.from({ length: nextItems.length }, () => null)
    setMyAnswers(empty)
    setPeerAnswers(empty)
    myAnswersRef.current = empty
    peerAnswersRef.current = empty
    setIndex(0)
    indexRef.current = 0
    setRevealing(false)
    revealingRef.current = false
    setPhase('play')
  }

  function resendStartIfAny() {
    const pending = pendingStartRef.current
    if (!pending || !sessionRef.current?.isHost) return
    sessionRef.current.sendReliable({
      type: 'start',
      items: pending.items,
      seq: pending.seq,
    })
  }

  function pushStart(nextItems: ChemistryItem[]) {
    const seq = startSeqRef.current + 1
    startSeqRef.current = seq
    pendingStartRef.current = { items: nextItems, seq }
    sessionRef.current?.sendReliable({
      type: 'start',
      items: nextItems,
      seq,
    })
    beginMatch(nextItems)
  }

  function onRoomOpen() {
    setError('')
    hello()
    if (!sessionRef.current?.isHost) {
      sessionRef.current?.sendReliable({ type: 'ready' })
      sessionRef.current?.sendReliable({ type: 'need-start' })
      return
    }
    resendStartIfAny()
  }

  function maybeRevealOrAdvance() {
    const i = indexRef.current
    const mine = myAnswersRef.current[i]
    const peer = peerAnswersRef.current[i]
    if (mine == null || peer == null) return
    if (revealingRef.current) return
    revealingRef.current = true
    setRevealing(true)
    window.clearTimeout(revealTimer.current)
    revealTimer.current = window.setTimeout(() => {
      const next = i + 1
      if (next >= itemsRef.current.length) {
        revealingRef.current = false
        setRevealing(false)
        setPhase('done')
        return
      }
      revealingRef.current = false
      setRevealing(false)
      indexRef.current = next
      setIndex(next)
    }, 1600)
  }

  function applyPeerAnswer(qIndex: number, choice: number) {
    const item = itemsRef.current[qIndex]
    if (!item) return
    if (choice < 0 || choice >= item.options.length) return
    setPeerAnswers((prev) => {
      const next = prev.length === itemsRef.current.length
        ? [...prev]
        : Array.from({ length: itemsRef.current.length }, (_, i) => prev[i] ?? null)
      if (next[qIndex] != null) return prev
      next[qIndex] = choice
      peerAnswersRef.current = next
      return next
    })
    window.setTimeout(() => maybeRevealOrAdvance(), 0)
  }

  function onData(raw: unknown) {
    const msg = raw as Msg
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return

    if (msg.type === 'hello') {
      setPeerWho(msg.who)
      if (!sessionRef.current?.isHost) {
        const mineWho = otherAbout(msg.who)
        if (whoRef.current !== mineWho) {
          setWho(mineWho)
          whoRef.current = mineWho
          sessionRef.current?.sendReliable({ type: 'hello', who: mineWho })
        }
        sessionRef.current?.sendReliable({ type: 'ready' })
      } else {
        resendStartIfAny()
      }
      return
    }
    if (msg.type === 'ready') {
      if (sessionRef.current?.isHost) {
        setPeerReady(true)
        resendStartIfAny()
      }
      return
    }
    if (msg.type === 'need-start') {
      if (sessionRef.current?.isHost) resendStartIfAny()
      return
    }
    if (msg.type === 'start') {
      if (!Array.isArray(msg.items) || msg.items.length === 0) return
      if (!msg.items.every(isChemistryItem)) return
      if (typeof msg.seq === 'number') {
        if (msg.seq === seenSeqRef.current) return
        seenSeqRef.current = msg.seq
      } else if (
        itemsRef.current.length > 0 &&
        itemsRef.current.length === msg.items.length &&
        itemsRef.current[0]?.id === msg.items[0]?.id
      ) {
        return
      }
      beginMatch(msg.items)
      return
    }
    if (msg.type === 'answer') {
      if (!Number.isInteger(msg.index) || !Number.isInteger(msg.choice)) return
      applyPeerAnswer(msg.index, msg.choice)
    }
  }

  function startMatch() {
    if (!isHost || busy || !peerReady || items.length > 0) return
    setBusy(true)
    setError('')
    try {
      const nextItems = buildChemistryMatch(roundsRef.current)
      hello()
      pushStart(nextItems)
    } catch (e) {
      setError(e instanceof Error ? e.message : '组题失败')
    } finally {
      setBusy(false)
    }
  }

  function playAgain() {
    if (!isHostRef.current || busy) return
    const session = sessionRef.current ?? room.session
    if (session && !sessionRef.current) sessionRef.current = session
    if (!session?.conn?.open) {
      setError('连接断了，没法再来一局')
      return
    }
    const epoch = getHubNavEpoch()
    setBusy(true)
    setError('')
    try {
      const nextItems = buildChemistryMatch(roundsRef.current)
      if (epoch !== getHubNavEpoch()) {
        setError('对方已回大厅')
        return
      }
      hello()
      pushStart(nextItems)
    } catch (e) {
      setError(e instanceof Error ? e.message : '组题失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (isHost || phase !== 'wait' || items.length > 0) return
    const tick = () => {
      sessionRef.current?.sendReliable({ type: 'ready' })
      sessionRef.current?.sendReliable({ type: 'need-start' })
      hello()
    }
    tick()
    const id = window.setInterval(tick, 1600)
    return () => window.clearInterval(id)
  }, [isHost, phase, items.length])

  // 双方答案到齐后，若当前题还没揭晓就补触发
  useEffect(() => {
    if (phase !== 'play') return
    if (myPick == null || peerPick == null) return
    maybeRevealOrAdvance()
  }, [phase, myPick, peerPick, index])

  function chemistryHandlers(): RoomHandlers {
    return {
      onData,
      onOpen: onRoomOpen,
      onDisconnect: () =>
        setError('对方暂时断线了（多半是息屏），正在等他回来…'),
      onClose: () => setError('对方断开了'),
    }
  }

  function navHandlers(handlers: RoomHandlers) {
    return withHubNav(handlers, {
      navigate,
      hereGame: 'chemistry',
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
    room.bindHandlers(navHandlers(chemistryHandlers()))
    isHostRef.current = role === 'host'
    setIsHost(role === 'host')
    if (role === 'host') setPeerReady(false)
    codeRef.current = session.code
    setCode(session.code)
    setPhase('wait')
    savePeerRoom({
      game: 'chemistry',
      code: session.code,
      role,
      who: whoRef.current,
    })
    if (kickOpen && session.conn?.open) onRoomOpen()
  }

  async function create(existingCode?: string) {
    setBusy(true)
    setError('')
    try {
      pendingStartRef.current = null
      startSeqRef.current = 0
      seenSeqRef.current = 0
      const handlers = navHandlers(chemistryHandlers())
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
      pendingStartRef.current = null
      startSeqRef.current = 0
      seenSeqRef.current = 0
      const handlers = navHandlers(chemistryHandlers())
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
      setError(
        e instanceof Error
          ? `${e.message}。确认对方仍在房间页，或让对方重新开房`
          : '加入失败',
      )
    } finally {
      setBusy(false)
    }
  }

  async function goHub() {
    if (leavingHubRef.current) return
    leavingHubRef.current = true
    const hubCode = codeRef.current || room.code
    pendingStartRef.current = null
    startSeqRef.current = 0
    seenSeqRef.current = 0
    window.clearTimeout(revealTimer.current)
    if (!hubCode) {
      clearPeerRoom('chemistry')
      navigate('/games', { replace: true })
      return
    }
    setBusy(true)
    setError('')
    await leaveGameToHub({
      sendReliable: (data, times) => room.sendReliable(data, times),
      code: hubCode,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
      navigate,
      onLocalLeave: () => {
        sessionRef.current = null
      },
    })
  }

  function pick(choice: number) {
    if (phase !== 'play' || !current || revealing) return
    if (myPick != null) return
    if (choice < 0 || choice >= current.options.length) return

    const next = myAnswers.map((v, i) => (i === index ? choice : v))
    // 若数组长度不对，重建
    const filled =
      next.length === items.length
        ? next
        : Array.from({ length: items.length }, (_, i) =>
            i === index ? choice : (myAnswers[i] ?? null),
          )
    setMyAnswers(filled)
    myAnswersRef.current = filled
    sessionRef.current?.sendReliable({ type: 'answer', index, choice })
    window.setTimeout(() => maybeRevealOrAdvance(), 0)
  }

  const inMatch = phase === 'play' || phase === 'done'
  const peerName = peerWho ? aboutLabel(peerWho) : '对方'
  const rate = total > 0 ? Math.round((matched / total) * 100) : 0
  const label = chemistrySyncLabel(matched, total)

  return (
    <GameShell
      title="默契问答"
      blurb={RULE}
      compact={inMatch}
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

      {phase === 'wait' && items.length === 0 ? (
        <>
          <RoomBanner
            code={code}
            detail={
              peerWho
                ? `${aboutLabel(who)} · ${aboutLabel(peerWho)}`
                : `${rounds} 题 · 升温`
            }
          />
          {isHost ? (
            <div className="mb-4 space-y-4">
              <div className="quiz-opts">
                <div>
                  <p className="quiz-opts-label">题数</p>
                  <div className="quiz-opts-row">
                    {CHEMISTRY_ROUNDS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={rounds === n ? 'is-on' : ''}
                        onClick={() => setRounds(n)}
                      >
                        {n} 题
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="game-lobby-primary"
                disabled={busy || !peerReady}
                onClick={startMatch}
              >
                {busy ? '准备中…' : peerReady ? '开始' : '等对方进房'}
              </button>
            </div>
          ) : null}
          <p className="text-sm text-[var(--ink-soft)]">
            {isHost
              ? peerReady
                ? `${rounds} 题，选一样算合拍`
                : `${rounds} 题，等对方加入`
              : '已进房，等开房的人开始…'}
          </p>
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        </>
      ) : null}

      {inMatch && items.length > 0 ? (
        <div className="space-y-4">
          <div className="chem-meter" aria-live="polite">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs tracking-[0.14em] text-[var(--ink-soft)]">
                默契 {matched}/{total}
              </p>
              <p className="text-xs text-[var(--ink-soft)]">
                {phase === 'done' ? label : `第 ${Math.min(index + 1, total)}/${total} 题`}
              </p>
            </div>
            <div className="chem-meter-bar" aria-hidden>
              <span style={{ width: `${total ? (matched / total) * 100 : 0}%` }} />
            </div>
          </div>

          {phase === 'play' && current ? (
            <div>
              <p className="font-display text-lg leading-snug text-[var(--ink)] sm:text-xl">
                {current.q}
              </p>

              {revealing && myPick != null && peerPick != null ? (
                <div
                  className={`chem-reveal ${myPick === peerPick ? 'is-match' : 'is-miss'}`}
                  role="status"
                >
                  <p className="chem-reveal-badge">
                    {myPick === peerPick ? '合拍' : '不一样也挺好'}
                  </p>
                  <div className="chem-reveal-grid">
                    <div>
                      <p className="text-xs text-[var(--ink-soft)]">
                        你 · {aboutLabel(who)}
                      </p>
                      <p className="mt-1 text-sm text-[var(--ink)]">
                        {current.options[myPick]}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--ink-soft)]">{peerName}</p>
                      <p className="mt-1 text-sm text-[var(--ink)]">
                        {current.options[peerPick]}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mt-3 space-y-1.5">
                    {current.options.map((opt, i) => {
                      const selected = myPick === i
                      return (
                        <button
                          key={`${current.id}-${opt}`}
                          type="button"
                          disabled={myPick != null}
                          onClick={() => pick(i)}
                          className={[
                            'min-h-11 w-full px-3 py-2.5 text-left text-sm transition',
                            selected
                              ? 'bg-[var(--leaf)] text-[var(--foam)]'
                              : 'bg-white/70 text-[var(--ink)]',
                          ].join(' ')}
                        >
                          {opt}
                        </button>
                      )
                    })}
                  </div>
                  {myPick != null && peerPick == null ? (
                    <p className="mt-3 text-center text-sm text-[var(--ink-soft)]">
                      已选好，等{peerName}…
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {phase === 'done' ? (
            <>
              <div className="chem-settle" role="status">
                <p className="chem-settle-eyebrow">本局默契</p>
                <p className="chem-settle-title">{rate}%</p>
                <p className="chem-settle-hint">
                  {matched}/{total} 题合拍 · {label}
                </p>
                <ul className="chem-settle-list">
                  {items.map((item, i) => {
                    const a = myAnswers[i]
                    const b = peerAnswers[i]
                    const ok = a != null && b != null && a === b
                    return (
                      <li key={item.id} className={ok ? 'is-ok' : ''}>
                        <span className="chem-settle-q">{item.q}</span>
                        <span className="chem-settle-a">
                          {ok
                            ? item.options[a!]
                            : `${a != null ? item.options[a] : '—'} / ${b != null ? item.options[b] : '—'}`}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div className="quiz-again">
                {isHost ? (
                  <button
                    type="button"
                    className="game-btn game-btn-leaf w-full"
                    disabled={busy}
                    onClick={playAgain}
                  >
                    {busy ? '准备中…' : '再来一局'}
                  </button>
                ) : (
                  <p className="text-center text-sm text-[var(--ink-soft)]">
                    等开房的人再来一局
                  </p>
                )}
              </div>
            </>
          ) : null}

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </GameShell>
  )
}
