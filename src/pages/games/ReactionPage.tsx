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

const RULE =
  '两边各自计时，比看到绿灯之后的反应，不受网络快慢影响。提前点算输这一轮。先到 5 分的赢。'
const WIN = 5

type Phase = 'lobby' | 'idle' | 'wait' | 'go' | 'early' | 'hold' | 'result' | 'done'
type Score = Record<NoteAbout, number>

type Msg =
  | {
      type: 'hello'
      who: NoteAbout
      her: number
      me: number
      round: number
      finished: boolean
      busy: boolean
    }
  | { type: 'ready'; round: number }
  | { type: 'arm'; round: number; delay: number }
  | { type: 'tap'; round: number; foul: boolean; ms?: number }
  | { type: 'again'; seq: number }

const ZERO: Score = { her: 0, me: 0 }

function readScore(her: unknown, me: unknown): Score | null {
  if (
    typeof her !== 'number' ||
    typeof me !== 'number' ||
    !Number.isInteger(her) ||
    !Number.isInteger(me) ||
    her < 0 ||
    me < 0 ||
    her > 50 ||
    me > 50
  ) {
    return null
  }
  return { her, me }
}

export function ReactionPage() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [code, setCode] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [score, setScore] = useState<Score>(ZERO)
  const [line, setLine] = useState('')
  const [iReady, setIReady] = useState(false)

  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  const peerWhoRef = useRef<NoteAbout | null>(null)
  const codeRef = useRef('')
  const phaseRef = useRef<Phase>('lobby')
  const scoreRef = useRef<Score>(ZERO)
  const playRoundRef = useRef(0)
  const resolvedRef = useRef(0)
  const myReadyRef = useRef(0)
  const peerReadyRef = useRef(0)
  const armedRef = useRef(0)
  const waitingRef = useRef(0)
  const myFoulRef = useRef(false)
  const peerFoulRef = useRef(false)
  const myMsRef = useRef<number | null>(null)
  const peerMsRef = useRef<number | null>(null)
  const lastArmRef = useRef<{ round: number; delay: number } | null>(null)
  const againSeqRef = useRef(0)
  const seenAgainRef = useRef(0)
  const timerRef = useRef(0)
  const startRef = useRef(0)

  whoRef.current = who
  peerWhoRef.current = peerWho
  codeRef.current = code

  const leavingHubRef = useRef(false)

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current)
      if (leavingHubRef.current) return
      sessionRef.current?.destroy()
      sessionRef.current = null
    },
    [],
  )

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!codeRef.current) return null
    return {
      game: 'reaction',
      code: codeRef.current,
      role: sessionRef.current?.isHost ? 'host' : 'joiner',
      who: whoRef.current,
    }
  })

  const resumeSavedRef = useRef<{
    code: string
    role: 'host' | 'joiner'
    who: NoteAbout
  } | null>(null)

  useResumePeerRoom('reaction', (saved) => {
    resumeSavedRef.current = { code: saved.code, role: saved.role, who: saved.who }
    setBusy(true)
    setError('')
    whoRef.current = saved.who
    setWho(saved.who)
    if (saved.role === 'host') void create(saved.code)
    else void join(saved.code)
  })

  function goPhase(next: Phase) {
    phaseRef.current = next
    setPhase(next)
  }

  function isBusyPhase() {
    const cur = phaseRef.current
    return cur === 'wait' || cur === 'go' || cur === 'early' || cur === 'hold'
  }

  function hello() {
    const finished =
      resolvedRef.current === playRoundRef.current && playRoundRef.current > 0
    sessionRef.current?.sendReliable({
      type: 'hello',
      who: whoRef.current,
      her: scoreRef.current.her,
      me: scoreRef.current.me,
      round: playRoundRef.current,
      finished,
      busy: isBusyPhase(),
    } satisfies Msg)
    const arm = lastArmRef.current
    if (sessionRef.current?.isHost && isBusyPhase() && arm) {
      sessionRef.current.sendReliable({ type: 'arm', round: arm.round, delay: arm.delay })
    }
    if (myFoulRef.current || myMsRef.current != null) {
      sessionRef.current?.sendReliable({
        type: 'tap',
        round: playRoundRef.current,
        foul: myFoulRef.current,
        ms: myMsRef.current ?? undefined,
      })
    }
    if (myReadyRef.current > 0) {
      sessionRef.current?.sendReliable({ type: 'ready', round: myReadyRef.current })
    }
  }

  function clearTaps() {
    myFoulRef.current = false
    peerFoulRef.current = false
    myMsRef.current = null
    peerMsRef.current = null
  }

  function resetMatch() {
    window.clearTimeout(timerRef.current)
    scoreRef.current = ZERO
    setScore(ZERO)
    playRoundRef.current = 0
    resolvedRef.current = 0
    myReadyRef.current = 0
    peerReadyRef.current = 0
    armedRef.current = 0
    waitingRef.current = 0
    lastArmRef.current = null
    clearTaps()
    setIReady(false)
    setLine('')
    goPhase('idle')
  }

  function winLine(leader: NoteAbout) {
    return leader === whoRef.current ? '你先到 5 分' : `${aboutLabel(leader)}先到 5 分`
  }

  function adoptScore(her: number, me: number) {
    const next = { her, me }
    scoreRef.current = next
    setScore(next)
    if (her >= WIN || me >= WIN) {
      const leader = her >= WIN ? 'her' : 'me'
      setLine(winLine(leader))
      goPhase('done')
    }
  }

  function beginWait(round: number, delay: number) {
    if (!Number.isInteger(round) || round < 1 || round > 500) return
    if (!Number.isInteger(delay) || delay < 500 || delay > 8000) return
    if (waitingRef.current === round) return
    waitingRef.current = round
    playRoundRef.current = round
    myReadyRef.current = 0
    setIReady(false)
    if (peerReadyRef.current === round) peerReadyRef.current = 0
    clearTaps()
    setLine('')
    goPhase('wait')
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      if (playRoundRef.current !== round || myFoulRef.current) return
      startRef.current = performance.now()
      goPhase('go')
    }, delay)
  }

  function maybeArm() {
    if (!sessionRef.current?.isHost) return
    const round = myReadyRef.current
    if (round < 1 || peerReadyRef.current !== round) return
    if (armedRef.current === round) return
    armedRef.current = round
    const delay = Math.round(1200 + Math.random() * 2800)
    lastArmRef.current = { round, delay }
    sessionRef.current.sendReliable({ type: 'arm', round, delay })
    beginWait(round, delay)
  }

  function tryResolve() {
    const round = playRoundRef.current
    if (resolvedRef.current === round || round < 1) return
    const mineIn = myFoulRef.current || myMsRef.current != null
    const peerIn = peerFoulRef.current || peerMsRef.current != null
    if (!mineIn || !peerIn) return
    resolvedRef.current = round
    const me = whoRef.current
    const them = peerWhoRef.current
    const themName = them ? aboutLabel(them) : '对方'
    let winner: NoteAbout | null = null
    let text = ''
    if (myFoulRef.current && peerFoulRef.current) {
      text = '都提前了，这轮不算'
    } else if (myFoulRef.current && them) {
      winner = them
      text = `你提前了，这轮算${themName}`
    } else if (peerFoulRef.current) {
      winner = me
      text = `${themName}提前了，这轮算你`
    } else if (myMsRef.current != null && peerMsRef.current != null) {
      const mine = myMsRef.current
      const theirs = peerMsRef.current
      if (mine === theirs) text = `都是 ${mine}ms，这轮不分`
      else if (mine < theirs) {
        winner = me
        text = `你 ${mine}ms · ${themName} ${theirs}ms`
      } else if (them) {
        winner = them
        text = `${themName} ${theirs}ms · 你 ${mine}ms`
      }
    }
    if (winner) {
      const next = { ...scoreRef.current, [winner]: scoreRef.current[winner] + 1 }
      scoreRef.current = next
      setScore(next)
      if (next.her >= WIN || next.me >= WIN) {
        const leader = next.her >= WIN ? 'her' : 'me'
        setLine(winLine(leader))
        goPhase('done')
        return
      }
    }
    setLine(text)
    goPhase('result')
  }

  function onData(raw: unknown) {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return
    const msg = raw as Msg
    if (msg.type === 'hello') {
      if (msg.who !== 'her' && msg.who !== 'me') return
      peerWhoRef.current = msg.who
      setPeerWho(msg.who)
      if (!sessionRef.current?.isHost) {
        const mine = otherAbout(msg.who)
        if (whoRef.current !== mine) {
          whoRef.current = mine
          setWho(mine)
          hello()
        }
      }
      const remoteScore = readScore(msg.her, msg.me)
      if (!remoteScore) return
      const remote = remoteScore.her + remoteScore.me
      const local = scoreRef.current.her + scoreRef.current.me
      if (local === 0 && remote > 0 && phaseRef.current !== 'done') {
        adoptScore(remoteScore.her, remoteScore.me)
      }
      if (
        playRoundRef.current === 0 &&
        Number.isInteger(msg.round) &&
        msg.round > 0 &&
        waitingRef.current === 0 &&
        phaseRef.current !== 'done'
      ) {
        playRoundRef.current = msg.round
        resolvedRef.current = msg.finished ? msg.round : Math.max(0, msg.round - 1)
      }
      return
    }
    if (msg.type === 'ready') {
      if (!Number.isInteger(msg.round) || msg.round < 1 || msg.round > 500) return
      peerReadyRef.current = msg.round
      maybeArm()
      return
    }
    if (msg.type === 'arm') {
      if (sessionRef.current?.isHost) return
      beginWait(msg.round, msg.delay)
      return
    }
    if (msg.type === 'tap') {
      if (msg.round !== playRoundRef.current) return
      if (peerFoulRef.current || peerMsRef.current != null) return
      if (msg.foul) {
        peerFoulRef.current = true
      } else if (
        typeof msg.ms === 'number' &&
        Number.isInteger(msg.ms) &&
        msg.ms >= 0 &&
        msg.ms < 10000
      ) {
        peerMsRef.current = msg.ms
      } else {
        return
      }
      tryResolve()
      return
    }
    if (msg.type === 'again') {
      if (!Number.isInteger(msg.seq) || msg.seq === seenAgainRef.current) return
      seenAgainRef.current = msg.seq
      resetMatch()
    }
  }

  function onRoomOpen() {
    setError('')
    hello()
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
          onWake: () => hello(),
          onDisconnect: () => setError('连接不稳，正在重连…'),
          onClose: () => setError('对方断开了'),
        },
        existingCode ? { code: existingCode } : undefined,
      )
      sessionRef.current = session
      setIsHost(true)
      codeRef.current = session.code
      setCode(session.code)
      goPhase('idle')
      savePeerRoom({
        game: 'reaction',
        code: session.code,
        role: 'host',
        who: whoRef.current,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '开房失败')
      goPhase('lobby')
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
        onWake: () => hello(),
        onDisconnect: () => setError('连接不稳，正在重连…'),
        onClose: () => setError('对方断开了'),
      })
      sessionRef.current = session
      setIsHost(false)
      codeRef.current = session.code
      setCode(session.code)
      goPhase('idle')
      savePeerRoom({
        game: 'reaction',
        code: session.code,
        role: 'joiner',
        who: whoRef.current,
      })
      hello()
    } catch (e) {
      setError(e instanceof Error ? e.message : '加入失败')
      goPhase('lobby')
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

  function readyUp() {
    if (!peerWhoRef.current) return
    if (phaseRef.current === 'done') return
    if (isBusyPhase()) return
    const target =
      resolvedRef.current === playRoundRef.current && playRoundRef.current > 0
        ? playRoundRef.current + 1
        : Math.max(playRoundRef.current, 1)
    if (myReadyRef.current === target) return
    myReadyRef.current = target
    setIReady(true)
    goPhase('idle')
    sessionRef.current?.sendReliable({ type: 'ready', round: target })
    maybeArm()
  }

  function tap() {
    if (myFoulRef.current || myMsRef.current != null) return
    const round = playRoundRef.current
    if (phaseRef.current === 'wait') {
      window.clearTimeout(timerRef.current)
      myFoulRef.current = true
      goPhase('early')
      sessionRef.current?.sendReliable({ type: 'tap', round, foul: true })
      tryResolve()
      return
    }
    if (phaseRef.current !== 'go') return
    const ms = Math.max(0, Math.round(performance.now() - startRef.current))
    myMsRef.current = ms
    goPhase('hold')
    sessionRef.current?.sendReliable({ type: 'tap', round, foul: false, ms })
    tryResolve()
  }

  function playAgain() {
    if (!sessionRef.current?.isHost) return
    const seq = againSeqRef.current + 1
    againSeqRef.current = seq
    sessionRef.current.sendReliable({ type: 'again', seq })
    resetMatch()
  }

  async function leaveRoom() {
    if (leavingHubRef.current) return
    leavingHubRef.current = true
    const roomCode = codeRef.current
    const role = sessionRef.current?.isHost ? 'host' : 'joiner'
    const me = whoRef.current
    const session = sessionRef.current
    sessionRef.current = null
    peerWhoRef.current = null
    setPeerWho(null)
    if (!roomCode) {
      clearPeerRoom('reaction')
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
  const padClass =
    phase === 'wait' || phase === 'early'
      ? 'game-react-pad is-wait'
      : phase === 'go'
        ? 'game-react-pad is-go'
        : 'game-react-pad is-idle'
  const padText = !peerWho
    ? '等对方进房'
    : phase === 'wait'
      ? '等绿…'
      : phase === 'go'
        ? '点！'
        : phase === 'early'
          ? '太早了'
          : phase === 'hold'
            ? `等${peerName}`
            : phase === 'result' || phase === 'done'
              ? line
              : iReady
                ? `等${peerName}`
                : '点这里开始'
  const padOff =
    !peerWho ||
    phase === 'hold' ||
    phase === 'early' ||
    phase === 'result' ||
    phase === 'done' ||
    (phase === 'idle' && iReady)

  return (
    <GameShell title="反应力" blurb={RULE} compact={phase !== 'lobby'}>
      {phase === 'lobby' ? (
        <EnterRoomGate
          busy={busy}
          status={busy ? '正在回到房间…' : undefined}
          error={busy ? undefined : error}
          onRetry={resumeSavedRef.current ? () => retryResume() : undefined}
        />
      ) : (
        <div className="space-y-4">
          {!peerWho ? (
            <RoomBanner code={code} detail={`你是${aboutLabel(who)} · 等对方`} />
          ) : (
            <>
              <div className="game-score-row">
                <div className="game-score">
                  <p className="game-score-label">你 · {aboutLabel(who)}</p>
                  <p className="game-score-value">{score[who]}</p>
                </div>
                <div className="game-score">
                  <p className="game-score-label">{peerName}</p>
                  <p className="game-score-value is-peer">{score[peerWho]}</p>
                </div>
              </div>
              <p className="-mt-2 text-center text-xs tracking-[0.16em] text-[var(--ink-soft)]">
                先到 5 分
              </p>
            </>
          )}

          <button
            type="button"
            className={padClass}
            disabled={padOff}
            onClick={() => {
              if (phase === 'idle') readyUp()
              else tap()
            }}
          >
            {padText}
          </button>

          {phase === 'result' ? (
            <button type="button" className="game-btn game-btn-leaf w-full" onClick={readyUp}>
              下一轮
            </button>
          ) : null}

          {phase === 'done' ? (
            isHost ? (
              <button type="button" className="game-btn game-btn-leaf w-full" onClick={playAgain}>
                再来一局
              </button>
            ) : (
              <p className="text-center text-sm text-[var(--ink-soft)]">等开房的人再开一局</p>
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
