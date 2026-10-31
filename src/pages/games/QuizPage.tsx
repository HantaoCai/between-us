import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnterRoomGate } from '../../components/EnterRoomGate'
import { GameShell } from '../../components/GameShell'
import { RoomBanner } from '../../components/PeerLobby'
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
import {
  buildQuizMatch,
  categoryLabel,
  prefetchQuizBankIndex,
  QUIZ_CATEGORIES,
  quizRoundOptions,
  type QuizCategory,
  type QuizItem,
} from '../../lib/quizBank'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import {
  getHubNavEpoch,
  leaveGameToHub,
  withHubNav,
} from '../../lib/hubNav'
import {
  clearPeerRoom,
  savePeerRoom,
  useFlushPeerRoomOnLeave,
} from '../../lib/peerRoomSave'
import { useGamePeerBoot } from '../../lib/useGamePeerBoot'

type Phase = 'lobby' | 'wait' | 'play' | 'done'

type AnswerRec = {
  choice: number
  ms: number
  correct: boolean
}

type Msg =
  | { type: 'hello'; who: NoteAbout }
  | { type: 'ready' }
  | { type: 'need-start' }
  | { type: 'start'; items: QuizItem[]; cat: QuizCategory; seq?: number }
  | { type: 'answer'; index: number; choice: number; ms: number }
  | { type: 'finished' }

function formatMs(ms: number): string {
  const s = ms / 1000
  if (s < 10) return `${s.toFixed(1)}s`
  return `${Math.round(s)}s`
}

function tally(answers: AnswerRec[]) {
  const correct = answers.filter((a) => a.correct).length
  const totalMs = answers.reduce((sum, a) => sum + a.ms, 0)
  return { answered: answers.length, correct, totalMs }
}

function verdict(
  me: ReturnType<typeof tally>,
  peer: ReturnType<typeof tally>,
  total: number,
) {
  if (me.answered < total || peer.answered < total) return null
  if (me.correct !== peer.correct) {
    return me.correct > peer.correct ? 'win' : 'lose'
  }
  if (me.totalMs !== peer.totalMs) {
    return me.totalMs < peer.totalMs ? 'win' : 'lose'
  }
  return 'draw'
}

export function QuizPage() {
  const navigate = useNavigate()
  const room = usePeerRoom()
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cat, setCat] = useState<QuizCategory>('mix')
  const [rounds, setRounds] = useState(10)
  const [items, setItems] = useState<QuizItem[]>([])
  const [index, setIndex] = useState(0)
  const [myAnswers, setMyAnswers] = useState<AnswerRec[]>([])
  const [peerAnswers, setPeerAnswers] = useState<AnswerRec[]>([])
  const [flash, setFlash] = useState<'ok' | 'bad' | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [matchCat, setMatchCat] = useState<QuizCategory>('mix')
  const [peerFinished, setPeerFinished] = useState(false)
  const [peerReady, setPeerReady] = useState(false)

  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  const itemsRef = useRef<QuizItem[]>([])
  const myAnswersRef = useRef<AnswerRec[]>([])
  const peerAnswersRef = useRef<AnswerRec[]>([])
  const peerFinishedRef = useRef(false)
  const roundsRef = useRef(rounds)
  const catRef = useRef(cat)
  const questionAtRef = useRef(0)
  const pendingStartRef = useRef<{
    items: QuizItem[]
    cat: QuizCategory
    seq: number
  } | null>(null)
  const startSeqRef = useRef(0)
  const seenSeqRef = useRef(0)
  const buildingRef = useRef(false)
  const flashTimer = useRef(0)

  whoRef.current = who
  itemsRef.current = items
  myAnswersRef.current = myAnswers
  peerAnswersRef.current = peerAnswers
  peerFinishedRef.current = peerFinished
  roundsRef.current = rounds
  catRef.current = cat

  const codeRef = useRef(code)
  const isHostRef = useRef(isHost)
  const leavingHubRef = useRef(false)
  codeRef.current = code
  isHostRef.current = isHost

  useEffect(() => {
    prefetchQuizBankIndex()
  }, [])

  usePeerSessionGuard(sessionRef, () => true)
  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!code) return null
    return {
      game: 'quiz',
      code,
      role: isHost ? 'host' : 'joiner',
      who: whoRef.current,
    }
  })

  const resumeSavedRef = useRef<{ code: string; role: 'host' | 'joiner'; who: NoteAbout } | null>(
    null,
  )

  useGamePeerBoot(
    'quiz',
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
    room.bindHandlers(navHandlers(quizHandlers()))
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

  useEffect(() => {
    const opts = quizRoundOptions(cat)
    if (!opts.includes(rounds)) setRounds(opts[opts.length - 1] ?? 5)
  }, [cat, rounds])

  const total = items.length || rounds
  const current = items[index]
  const mine = useMemo(() => tally(myAnswers), [myAnswers])
  const peer = useMemo(() => tally(peerAnswers), [peerAnswers])
  const iDone = myAnswers.length >= total && total > 0
  const peerDone = peerAnswers.length >= total && total > 0
  const result = useMemo(
    () => (phase === 'done' ? verdict(mine, peer, total) : null),
    [phase, mine, peer, total],
  )

  useEffect(() => {
    if (phase !== 'play') return
    if (!iDone) return
    if (peerDone || peerFinished) setPhase('done')
  }, [phase, iDone, peerDone, peerFinished])

  function send(msg: Msg) {
    sessionRef.current?.send(msg)
  }

  function hello() {
    sessionRef.current?.sendReliable({ type: 'hello', who: whoRef.current })
  }

  function beginMatch(nextItems: QuizItem[], nextCat: QuizCategory) {
    setItems(nextItems)
    itemsRef.current = nextItems
    setRounds(nextItems.length)
    roundsRef.current = nextItems.length
    setMatchCat(nextCat)
    setIndex(0)
    setMyAnswers([])
    setPeerAnswers([])
    myAnswersRef.current = []
    peerAnswersRef.current = []
    peerFinishedRef.current = false
    setPeerFinished(false)
    setFlash(null)
    questionAtRef.current = Date.now()
    setPhase('play')
  }

  function resendStartIfAny() {
    const pending = pendingStartRef.current
    if (!pending || !sessionRef.current?.isHost) return
    sessionRef.current.sendReliable({
      type: 'start',
      items: pending.items,
      cat: pending.cat,
      seq: pending.seq,
    })
  }

  function pushStart(nextItems: QuizItem[], nextCat: QuizCategory) {
    const seq = startSeqRef.current + 1
    startSeqRef.current = seq
    pendingStartRef.current = { items: nextItems, cat: nextCat, seq }
    sessionRef.current?.sendReliable({
      type: 'start',
      items: nextItems,
      cat: nextCat,
      seq,
    })
    beginMatch(nextItems, nextCat)
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

  function applyPeerAnswer(index: number, choice: number, ms: number) {
    const item = itemsRef.current[index]
    if (!item) return
    setPeerAnswers((prev) => {
      if (index < prev.length) return prev
      if (index > prev.length) return prev
      const next = [...prev, { choice, ms, correct: choice === item.answer }]
      peerAnswersRef.current = next
      return next
    })
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
        // 对方又打了招呼：若题已出好，补发开局
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
      beginMatch(msg.items, msg.cat || 'mix')
      return
    }
    if (msg.type === 'answer') {
      applyPeerAnswer(msg.index, msg.choice, msg.ms)
      return
    }
    if (msg.type === 'finished') {
      peerFinishedRef.current = true
      setPeerFinished(true)
    }
  }

  async function startMatch() {
    if (!isHost || busy || !peerReady || items.length > 0 || buildingRef.current) return
    buildingRef.current = true
    try {
      setBusy(true)
      setError('')
      const nextItems = await buildQuizMatch(catRef.current, roundsRef.current)
      if (nextItems.length === 0) {
        setError('组题失败，换个分类再试')
        return
      }
      hello()
      pushStart(nextItems, catRef.current)
    } catch (e) {
      setError(e instanceof Error ? e.message : '组题失败')
    } finally {
      buildingRef.current = false
      setBusy(false)
    }
  }

  function liveSession() {
    return sessionRef.current ?? room.session
  }

  /** 本页再开一局，不回大厅；若期间对方回了大厅则放弃 */
  async function playAgain() {
    if (!isHostRef.current) return
    if (busy || buildingRef.current) {
      setError('正在抽题，稍等…')
      return
    }
    const session = liveSession()
    if (session && !sessionRef.current) sessionRef.current = session
    if (!session?.conn?.open) {
      setError('连接断了，没法再来一局')
      return
    }
    const epoch = getHubNavEpoch()
    buildingRef.current = true
    try {
      setBusy(true)
      setError('')
      const nextItems = await buildQuizMatch(catRef.current, roundsRef.current)
      if (epoch !== getHubNavEpoch()) {
        setError('对方已回大厅')
        return
      }
      if (nextItems.length === 0) {
        setError('组题失败，换个分类再试')
        return
      }
      hello()
      pushStart(nextItems, catRef.current)
    } catch (e) {
      setError(e instanceof Error ? e.message : '组题失败')
    } finally {
      buildingRef.current = false
      setBusy(false)
    }
  }

  // 加入方卡在等待开题时，主动要开局包
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

  function quizHandlers() {
    return {
      onData,
      onOpen: onRoomOpen,
      onDisconnect: () => setError('连接不稳，正在重连…'),
      onClose: () => setError('对方断开了'),
    }
  }

  function navHandlers(handlers: RoomHandlers) {
    return withHubNav(handlers, {
      navigate,
      hereGame: 'quiz',
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

  function bindQuizSession(
    session: RoomSession,
    role: 'host' | 'joiner',
    kickOpen: boolean,
  ) {
    sessionRef.current = session
    room.attachSession(session, { who: whoRef.current })
    room.bindHandlers(navHandlers(quizHandlers()))
    isHostRef.current = role === 'host'
    setIsHost(role === 'host')
    if (role === 'host') setPeerReady(false)
    codeRef.current = session.code
    setCode(session.code)
    setPhase('wait')
    savePeerRoom({
      game: 'quiz',
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
      buildingRef.current = false
      startSeqRef.current = 0
      seenSeqRef.current = 0
      const handlers = navHandlers(quizHandlers())
      if (existingCode) {
        const live = await adoptParkedSession(existingCode, true, handlers)
        if (live) {
          bindQuizSession(live, 'host', true)
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
      bindQuizSession(session, 'host', false)
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
      const handlers = navHandlers(quizHandlers())
      const live = await adoptParkedSession(roomCode, false, handlers)
      if (live) {
        bindQuizSession(live, 'joiner', true)
        return
      }
      sessionRef.current?.destroy()
      sessionRef.current = null
      await releaseParkedRoom(roomCode)
      const session = await joinPeerRoom(roomCode, handlers)
      bindQuizSession(session, 'joiner', false)
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
    buildingRef.current = false
    startSeqRef.current = 0
    seenSeqRef.current = 0
    if (!hubCode) {
      clearPeerRoom('quiz')
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
    if (phase !== 'play' || !current || flash) return
    if (myAnswers.length !== index) return

    const ms = Math.max(0, Date.now() - questionAtRef.current)
    const correct = choice === current.answer
    const rec: AnswerRec = { choice, ms, correct }
    const nextAnswers = [...myAnswers, rec]
    setMyAnswers(nextAnswers)
    myAnswersRef.current = nextAnswers
    send({ type: 'answer', index, choice, ms })

    setFlash(correct ? 'ok' : 'bad')
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => {
      setFlash(null)
      if (nextAnswers.length >= itemsRef.current.length) {
        send({ type: 'finished' })
        if (
          peerAnswersRef.current.length >= itemsRef.current.length ||
          peerFinishedRef.current
        ) {
          setPhase('done')
        }
        return
      }
      setIndex(nextAnswers.length)
      questionAtRef.current = Date.now()
    }, 480)
  }

  const inMatch = phase === 'play' || phase === 'done'
  const peerName = peerWho ? aboutLabel(peerWho) : '对方'

  return (
    <GameShell
      title="答题对战"
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
                ? `${aboutLabel(who)} vs ${aboutLabel(peerWho)}`
                : `${categoryLabel(cat)} · ${rounds} 题`
            }
          />
          {isHost ? (
            <div className="mb-4 space-y-4">
              <QuizOptionPicker
                cat={cat}
                rounds={rounds}
                onCat={setCat}
                onRounds={setRounds}
              />
              <button
                type="button"
                className="game-lobby-primary"
                disabled={busy || !peerReady}
                onClick={() => void startMatch()}
              >
                {busy ? '抽题中…' : peerReady ? '开赛' : '等对方进房'}
              </button>
            </div>
          ) : null}
          <p className="text-sm text-[var(--ink-soft)]">
            {busy
              ? '正在抽题…'
              : isHost
                ? peerReady
                  ? `题库「${categoryLabel(cat)}」· ${rounds} 题，可以开赛`
                  : `题库「${categoryLabel(cat)}」· ${rounds} 题，等对方加入`
                : '已进房，等房主开赛…'}
          </p>
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        </>
      ) : null}

      {inMatch && items.length > 0 ? (
        <div className="space-y-4">
          <div className="quiz-race">
            <ProgressCard
              name={aboutLabel(who)}
              accent="me"
              answered={mine.answered}
              total={total}
              correct={mine.correct}
              totalMs={mine.totalMs}
              done={iDone}
            />
            <ProgressCard
              name={peerName}
              accent="peer"
              answered={peer.answered}
              total={total}
              correct={peer.correct}
              totalMs={peer.totalMs}
              done={peerDone || peerFinished}
            />
          </div>

          {phase === 'play' && !iDone && current ? (
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="text-xs tracking-wider text-[var(--ink-soft)]">
                  {categoryLabel(matchCat)} · 第 {index + 1}/{total} 题
                </p>
                {flash ? (
                  <p
                    className={
                      flash === 'ok'
                        ? 'text-sm text-[var(--leaf)]'
                        : 'text-sm text-[#b42318]'
                    }
                  >
                    {flash === 'ok' ? '对了' : '错了'}
                  </p>
                ) : null}
              </div>
              <p className="font-display text-lg leading-snug text-[var(--ink)] sm:text-xl">
                {current.q}
              </p>
              <div className="mt-3 space-y-1.5">
                {current.options.map((opt, i) => {
                  const selected = flash != null && myAnswers[index]?.choice === i
                  const showAnswer = flash != null
                  const correct = i === current.answer
                  return (
                    <button
                      key={`${current.id}-${opt}`}
                      type="button"
                      disabled={flash != null}
                      onClick={() => pick(i)}
                      className={[
                        'min-h-11 w-full px-3 py-2.5 text-left text-sm transition',
                        showAnswer && correct
                          ? 'bg-[var(--leaf)] text-[var(--foam)]'
                          : selected
                            ? 'bg-[var(--cork-ink)] text-[var(--foam)]'
                            : 'bg-white/70 text-[var(--ink)]',
                      ].join(' ')}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {phase === 'play' && iDone ? (
            <p className="py-8 text-center text-sm text-[var(--ink-soft)]">
              你已答完，等对方…
              <span className="mt-1 block text-xs">
                对方 {peer.answered}/{total}
              </span>
            </p>
          ) : null}

          {phase === 'done' && result ? (
            <>
              <QuizSettle
                result={result}
                meName={aboutLabel(who)}
                peerName={peerName}
                mine={mine}
                peer={peer}
                total={total}
              />
              <div className="quiz-again">
                {isHost ? (
                  <button
                    type="button"
                    className="game-btn game-btn-leaf w-full"
                    disabled={busy}
                    onClick={() => void playAgain()}
                  >
                    {busy ? '抽题中…' : '再来一局'}
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

function QuizOptionPicker({
  cat,
  rounds,
  onCat,
  onRounds,
}: {
  cat: QuizCategory
  rounds: number
  onCat: (cat: QuizCategory) => void
  onRounds: (rounds: number) => void
}) {
  const roundOpts = quizRoundOptions(cat)
  return (
    <div className="quiz-opts">
      <div>
        <p className="quiz-opts-label">题库</p>
        <div className="quiz-opts-grid">
          {QUIZ_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cat === c.id ? 'is-on' : ''}
              onClick={() => onCat(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="quiz-opts-label">题数</p>
        <div className="quiz-opts-row">
          {roundOpts.map((n) => (
            <button
              key={n}
              type="button"
              className={rounds === n ? 'is-on' : ''}
              onClick={() => onRounds(n)}
            >
              {n} 题
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProgressCard({
  name,
  accent,
  answered,
  total,
  correct,
  totalMs,
  done,
}: {
  name: string
  accent: 'me' | 'peer'
  answered: number
  total: number
  correct: number
  totalMs: number
  done: boolean
}) {
  const pct = total > 0 ? Math.min(100, (answered / total) * 100) : 0
  return (
    <div className={`quiz-race-card is-${accent}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--ink-soft)]">{name}</p>
        <p className="text-xs text-[var(--ink-soft)]">
          {done ? '完成' : `${answered}/${total}`}
        </p>
      </div>
      <div className="quiz-race-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-sm text-[var(--ink)]">
        对 {correct}
        <span className="mx-1 text-[var(--ink-soft)]/50">·</span>
        {formatMs(totalMs)}
      </p>
    </div>
  )
}

function QuizSettle({
  result,
  meName,
  peerName,
  mine,
  peer,
  total,
}: {
  result: 'win' | 'lose' | 'draw'
  meName: string
  peerName: string
  mine: ReturnType<typeof tally>
  peer: ReturnType<typeof tally>
  total: number
}) {
  const title =
    result === 'win' ? '你赢了' : result === 'lose' ? '对方赢了' : '平手'

  return (
    <div className={`quiz-settle is-${result}`} role="status">
      <div className="quiz-settle-stage" aria-hidden>
        <span className="quiz-settle-ring quiz-settle-ring-a" />
        <span className="quiz-settle-ring quiz-settle-ring-b" />
        <span className="quiz-settle-ring quiz-settle-ring-c" />
        {result === 'win'
          ? Array.from({ length: 12 }, (_, i) => (
              <span
                key={i}
                className="quiz-settle-spark"
                style={{
                  ['--i' as string]: i,
                  ['--x' as string]: `${((i % 6) - 2.5) * 18}%`,
                  ['--delay' as string]: `${0.12 + i * 0.05}s`,
                }}
              />
            ))
          : null}
        {result === 'lose' ? <span className="quiz-settle-sink" /> : null}
        {result === 'draw' ? (
          <>
            <span className="quiz-settle-balance is-left" />
            <span className="quiz-settle-balance is-right" />
          </>
        ) : null}
      </div>

      <p className="quiz-settle-eyebrow">本局结束</p>
      <p className="quiz-settle-title">{title}</p>
      <p className="quiz-settle-hint">先比答对题数，相同再比总用时</p>

      <div className="quiz-finish-grid">
        <FinishStat
          name={meName}
          correct={mine.correct}
          total={total}
          totalMs={mine.totalMs}
          accent="me"
          highlight={result === 'win'}
        />
        <FinishStat
          name={peerName}
          correct={peer.correct}
          total={total}
          totalMs={peer.totalMs}
          accent="peer"
          highlight={result === 'lose'}
        />
      </div>
    </div>
  )
}

function FinishStat({
  name,
  correct,
  total,
  totalMs,
  accent,
  highlight,
}: {
  name: string
  correct: number
  total: number
  totalMs: number
  accent: 'me' | 'peer'
  highlight?: boolean
}) {
  const rate = total > 0 ? Math.round((correct / total) * 100) : 0
  return (
    <div
      className={[
        'quiz-finish-card',
        `is-${accent}`,
        highlight ? 'is-winner' : '',
      ].join(' ')}
    >
      <p className="text-xs text-[var(--ink-soft)]">{name}</p>
      <p className="font-display mt-1 text-3xl text-[var(--ink)]">{rate}%</p>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        {correct}/{total} 对 · {formatMs(totalMs)}
      </p>
    </div>
  )
}
