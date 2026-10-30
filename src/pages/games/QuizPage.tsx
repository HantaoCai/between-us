import { useEffect, useMemo, useRef, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { PeerLobby, RoomBanner } from '../../components/PeerLobby'
import {
  createPeerRoom,
  joinPeerRoom,
  type RoomSession,
} from '../../lib/peerRoom'
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
  clearPeerRoom,
  savePeerRoom,
  useFlushPeerRoomOnLeave,
} from '../../lib/peerRoomSave'
import { useConfirmLeaveGame } from '../../lib/useConfirmLeaveGame'
import { useResumePeerRoom } from '../../lib/useResumePeerRoom'

type Phase = 'lobby' | 'wait' | 'play' | 'done'

type AnswerRec = {
  choice: number
  ms: number
  correct: boolean
}

type Msg =
  | { type: 'hello'; who: NoteAbout }
  | { type: 'start'; items: QuizItem[]; cat: QuizCategory }
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
  } | null>(null)
  const buildingRef = useRef(false)
  const flashTimer = useRef(0)

  whoRef.current = who
  itemsRef.current = items
  myAnswersRef.current = myAnswers
  peerAnswersRef.current = peerAnswers
  peerFinishedRef.current = peerFinished
  roundsRef.current = rounds
  catRef.current = cat

  useConfirmLeaveGame(phase !== 'lobby' && phase !== 'done')

  useEffect(() => {
    prefetchQuizBankIndex()
  }, [])

  useEffect(() => () => {
    sessionRef.current?.destroy()
    window.clearTimeout(flashTimer.current)
  }, [])

  useEffect(() => {
    if (phase === 'done') clearPeerRoom('quiz')
  }, [phase])

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!code) return null
    return {
      game: 'quiz',
      code,
      role: isHost ? 'host' : 'joiner',
      who: whoRef.current,
    }
  })

  useResumePeerRoom('quiz', (saved) => {
    setBusy(true)
    setError('')
    whoRef.current = saved.who
    setWho(saved.who)
    if (saved.role === 'host') void create(saved.code)
    else void join(saved.code)
  })

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

  function pushStart(nextItems: QuizItem[], nextCat: QuizCategory) {
    pendingStartRef.current = { items: nextItems, cat: nextCat }
    sessionRef.current?.sendReliable({
      type: 'start',
      items: nextItems,
      cat: nextCat,
    })
    beginMatch(nextItems, nextCat)
  }

  function onRoomOpen() {
    setError('')
    hello()
    const pending = pendingStartRef.current
    if (pending && sessionRef.current?.isHost) {
      sessionRef.current.sendReliable({
        type: 'start',
        items: pending.items,
        cat: pending.cat,
      })
    }
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
      }
      return
    }
    if (msg.type === 'start') {
      if (!Array.isArray(msg.items) || msg.items.length === 0) return
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

  useEffect(() => {
    if (!isHost || !peerWho || items.length > 0 || buildingRef.current) return
    let cancelled = false
    buildingRef.current = true
    ;(async () => {
      try {
        setBusy(true)
        setError('')
        const nextItems = await buildQuizMatch(catRef.current, roundsRef.current)
        if (cancelled) return
        if (nextItems.length === 0) {
          setError('组题失败，换个分类再试')
          buildingRef.current = false
          return
        }
        hello()
        pushStart(nextItems, catRef.current)
      } catch (e) {
        if (!cancelled) {
          buildingRef.current = false
          setError(e instanceof Error ? e.message : '组题失败')
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
      if (items.length === 0 && !pendingStartRef.current) {
        buildingRef.current = false
      }
    }
  }, [isHost, peerWho, items.length])

  async function create(existingCode?: string) {
    setBusy(true)
    setError('')
    try {
      sessionRef.current?.destroy()
      pendingStartRef.current = null
      buildingRef.current = false
      const session = await createPeerRoom(
        {
          onData,
          onOpen: onRoomOpen,
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
        game: 'quiz',
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
      pendingStartRef.current = null
      const session = await joinPeerRoom(room, {
        onData,
        onOpen: onRoomOpen,
        onDisconnect: () => setError('连接不稳，正在重连…'),
        onClose: () => setError('对方断开了'),
      })
      sessionRef.current = session
      setIsHost(false)
      setCode(session.code)
      setPhase('wait')
      savePeerRoom({
        game: 'quiz',
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
  const roundOpts = quizRoundOptions(cat)
  const peerName = peerWho ? aboutLabel(peerWho) : '对方'

  return (
    <GameShell title="答题对战" compact={inMatch}>
      {phase === 'lobby' ? (
        <PeerLobby
          busy={busy}
          error={error}
          who={who}
          onWho={setWho}
          onCreate={() => void create()}
          onJoin={(c) => void join(c)}
          extra={
            <div className="quiz-opts">
              <div>
                <p className="quiz-opts-label">题库</p>
                <div className="quiz-opts-grid">
                  {QUIZ_CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={cat === c.id ? 'is-on' : ''}
                      onClick={() => setCat(c.id)}
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
                      onClick={() => setRounds(n)}
                    >
                      {n} 题
                    </button>
                  ))}
                </div>
              </div>
            </div>
          }
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
          <p className="text-sm text-[var(--ink-soft)]">
            {busy
              ? '正在抽题…'
              : isHost
                ? `题库「${categoryLabel(cat)}」· ${rounds} 题，等对方进来开赛`
                : '已进房，等房主开题…'}
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
            <QuizSettle
              result={result}
              meName={aboutLabel(who)}
              peerName={peerName}
              mine={mine}
              peer={peer}
              total={total}
            />
          ) : null}

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </GameShell>
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
