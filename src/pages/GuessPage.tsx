import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnterRoomGate } from '../components/EnterRoomGate'
import { GameShell } from '../components/GameShell'
import { RoomBanner } from '../components/PeerLobby'
import {
  countHits,
  formatHits,
  isValidNumber,
  type DigitLen,
  type GuessResult,
} from '../lib/guessGame'
import {
  getHubNavEpoch,
  leaveGameToHub,
  withHubNav,
} from '../lib/hubNav'
import { aboutLabel, otherAbout, type NoteAbout } from '../lib/notes'
import { peerLog } from '../lib/peerLog'
import { usePeerRoom } from '../lib/PeerRoomContext'
import {
  adoptParkedSession,
  releaseParkedRoom,
} from '../lib/peerHandoff'
import {
  createPeerRoom,
  joinPeerRoom,
  type RoomHandlers,
  type RoomSession,
} from '../lib/peerRoom'
import { usePeerSessionGuard } from '../lib/usePeerSessionGuard'
import {
  clearPeerRoom,
  patchPeerRoom,
  savePeerRoom,
  useFlushPeerRoomOnLeave,
  type SavedPeerRoom,
} from '../lib/peerRoomSave'
import { useGamePeerBoot } from '../lib/useGamePeerBoot'

type Phase = 'lobby' | 'secret' | 'wait' | 'play' | 'done'

type WireMessage =
  | { type: 'hello'; who: NoteAbout; digits: DigitLen }
  | { type: 'digits'; digits: DigitLen }
  | { type: 'secret-ready'; digits: DigitLen }
  | { type: 'guess'; guess: string; requestId: string }
  | {
      type: 'guess-result'
      requestId: string
      guess: string
      hits: number
    }
  | { type: 'progress'; guesses: GuessResult[] }
  | { type: 'solved'; turns: number }
  | { type: 'again'; seq: number }

function isWire(raw: unknown): raw is WireMessage {
  return !!raw && typeof raw === 'object' && 'type' in raw
}

export function GuessPage() {
  const navigate = useNavigate()
  const room = usePeerRoom()
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [digits, setDigits] = useState<DigitLen>(4)
  const [roomCode, setRoomCode] = useState('')
  const [status, setStatus] = useState('连接中…')
  const [error, setError] = useState('')
  const [secret, setSecret] = useState('')
  const [secretLocked, setSecretLocked] = useState(false)
  const [peerReady, setPeerReady] = useState(false)
  const [draftGuess, setDraftGuess] = useState('')
  const [myGuesses, setMyGuesses] = useState<GuessResult[]>([])
  const [peerGuesses, setPeerGuesses] = useState<GuessResult[]>([])
  const [iSolved, setISolved] = useState(false)
  const [peerSolved, setPeerSolved] = useState(false)
  const [peerTurns, setPeerTurns] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [guessBusy, setGuessBusy] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [linked, setLinked] = useState(false)

  const sessionRef = useRef<RoomSession | null>(null)
  const secretRef = useRef('')
  const myGuessesRef = useRef<GuessResult[]>([])
  const whoRef = useRef(who)
  const digitsRef = useRef(digits)
  const secretLockedRef = useRef(false)
  const peerReadyRef = useRef(false)
  const roomCodeRef = useRef(roomCode)
  const isHostRef = useRef(false)
  const iSolvedRef = useRef(false)
  const againSeqRef = useRef(0)
  const linkedRef = useRef(false)
  const leavingHubRef = useRef(false)

  secretRef.current = secret
  myGuessesRef.current = myGuesses
  whoRef.current = who
  digitsRef.current = digits
  secretLockedRef.current = secretLocked
  peerReadyRef.current = peerReady
  iSolvedRef.current = iSolved
  roomCodeRef.current = roomCode
  isHostRef.current = isHost
  linkedRef.current = linked

  usePeerSessionGuard(sessionRef, () => true)

  useEffect(() => {
    if (secretLocked && peerReady && phase === 'wait') {
      setPhase('play')
      setStatus('开始猜吧，两边可以同时猜')
    }
  }, [secretLocked, peerReady, phase])

  // 卡在「等对方提交」时持续补发就绪：对方若先一步进猜数，第一包 secret-ready 很容易丢
  useEffect(() => {
    if (phase !== 'wait' || !secretLocked) return
    const tick = () => {
      if (!secretLockedRef.current) return
      if (!isConnOpen() && !linkedRef.current) return
      sendSecretReady()
      hello()
    }
    tick()
    const id = window.setInterval(tick, 1200)
    return () => window.clearInterval(id)
  }, [phase, secretLocked])

  useEffect(() => {
    if (!iSolved || !peerSolved || phase !== 'play') return
    const mine = myGuesses.length
    const theirs = peerTurns ?? peerGuesses.length
    if (mine < theirs) setStatus(`你赢了 · ${mine} 轮 vs ${theirs} 轮`)
    else if (mine > theirs) setStatus(`对方赢了 · ${mine} 轮 vs ${theirs} 轮`)
    else setStatus(`平局 · 都是 ${mine} 轮`)
    setPhase('done')
  }, [iSolved, peerSolved, phase, myGuesses.length, peerGuesses.length, peerTurns])

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!roomCode, () => {
    if (!roomCodeRef.current) return null
    return {
      game: 'guess',
      code: roomCodeRef.current,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
      digits: digitsRef.current,
      secret: secretRef.current || undefined,
      secretLocked: secretLockedRef.current,
    }
  })

  const resumeSavedRef = useRef<SavedPeerRoom | null>(null)

  useGamePeerBoot(
    'guess',
    () => {
      adoptLiveFromProvider()
    },
    (saved) => {
      resumeSavedRef.current = saved
      setBusy(true)
      setError('')
      setStatus(`正在回到房间 ${saved.code}…`)
      applySavedIdentity(saved)
      if (saved.role === 'host') void create(saved.code)
      else void join(saved.code)
    },
  )

  function adoptLiveFromProvider() {
    const session = room.session
    if (!session) return
    leavingHubRef.current = false
    room.bindHandlers(navHandlers(roomHandlers()))
    sessionRef.current = session
    whoRef.current = room.who
    setWho(room.who)
    isHostRef.current = room.isHost
    setIsHost(room.isHost)
    roomCodeRef.current = room.code
    setRoomCode(room.code)
    if (room.peerWho) setPeerWho(room.peerWho)
    setBusy(false)
    setError('')
    setPhase(secretLockedRef.current ? 'wait' : 'secret')
    // 从大厅跟进来时通道通常已开；即使 open 标志偶发滞后，有 peerWho 也先当已连上
    if (session.conn?.open || room.peerWho) {
      markLinked()
      return
    }
    linkedRef.current = false
    setLinked(false)
    setStatus(
      session.isHost
        ? `房间 ${session.code} · 等对方进房后一起写数字`
        : '正在连对方…',
    )
  }

  function applySavedIdentity(saved: SavedPeerRoom) {
    whoRef.current = saved.who
    setWho(saved.who)
    if (saved.digits === 4 || saved.digits === 5) {
      digitsRef.current = saved.digits
      setDigits(saved.digits)
    }
    if (saved.secret) {
      secretRef.current = saved.secret
      setSecret(saved.secret)
    }
    if (saved.secretLocked) {
      secretLockedRef.current = true
      setSecretLocked(true)
    }
  }

  function persistRoom(role: 'host' | 'joiner', code: string) {
    savePeerRoom({
      game: 'guess',
      code,
      role,
      who: whoRef.current,
      digits: digitsRef.current,
      secret: secretRef.current || undefined,
      secretLocked: secretLockedRef.current,
    })
  }

  function liveSession() {
    return sessionRef.current ?? room.session
  }

  function isConnOpen() {
    const s = liveSession()
    return !!s?.conn?.open
  }

  function send(msg: WireMessage) {
    const s = liveSession()
    if (s) {
      s.send(msg)
      return
    }
    room.send(msg)
  }

  function sendReliable(msg: WireMessage) {
    const s = liveSession()
    if (s) {
      s.sendReliable(msg)
      return
    }
    room.sendReliable(msg)
  }

  function sendSecretReady() {
    sendReliable({ type: 'secret-ready', digits: digitsRef.current })
  }

  function hello() {
    sendReliable({
      type: 'hello',
      who: whoRef.current,
      digits: digitsRef.current,
    })
    if (secretRef.current && secretLockedRef.current) {
      peerLog('猜数字：发出 secret-ready', {
        who: whoRef.current,
        code: roomCodeRef.current,
      })
      sendSecretReady()
    }
  }

  /** 对方已在猜 / 发进度 = 对方早就提交过了 */
  function markPeerReady(reason: string) {
    if (peerReadyRef.current) return
    peerReadyRef.current = true
    setPeerReady(true)
    peerLog('猜数字：对方就绪', reason)
    setStatus(
      secretLockedRef.current
        ? '对方也准备好了'
        : '对方已提交数字，等你提交',
    )
  }

  function markLinked() {
    linkedRef.current = true
    setLinked(true)
    setError('')
    setPhase((p) => {
      if (p === 'lobby') return secretLockedRef.current ? 'wait' : 'secret'
      return p
    })
    setStatus(
      secretLockedRef.current
        ? peerReadyRef.current
          ? '双方就绪，开始猜吧'
          : '已连上，等待双方就绪'
        : '已连上，先各自写一个数字',
    )
    hello()
  }

  function resetMatch(status?: string) {
    secretRef.current = ''
    secretLockedRef.current = false
    peerReadyRef.current = false
    myGuessesRef.current = []
    iSolvedRef.current = false
    setSecret('')
    setSecretLocked(false)
    setPeerReady(false)
    setDraftGuess('')
    setMyGuesses([])
    setPeerGuesses([])
    setISolved(false)
    setPeerSolved(false)
    setPeerTurns(null)
    setGuessBusy(false)
    setError('')
    setPhase('secret')
    setStatus(
      status ??
        (linkedRef.current ? '新一局，先各自写一个数字' : '等对方进房后再写数字'),
    )
    patchPeerRoom({
      secret: undefined,
      secretLocked: false,
      digits: digitsRef.current,
      who: whoRef.current,
    })
  }

  // 位数变了之后，已经提交的题作废，按新位数重新出题
  function applyDigitLen(n: number) {
    if (n !== 4 && n !== 5) return
    if (n === digitsRef.current) return
    digitsRef.current = n
    setDigits(n)
    const roundStarted =
      secretLockedRef.current ||
      peerReadyRef.current ||
      myGuessesRef.current.length > 0
    if (roundStarted) {
      resetMatch(`改成 ${n} 位了，请重新出题`)
      return
    }
    setSecret((s) => {
      const next = s.slice(0, n)
      secretRef.current = next
      return next
    })
    patchPeerRoom({
      digits: n,
      secret: secretRef.current || undefined,
      secretLocked: false,
      who: whoRef.current,
    })
  }

  function playAgain() {
    if (!isHostRef.current) return
    if (!isConnOpen()) {
      setError('连接断了，没法再来一局')
      return
    }
    const epoch = getHubNavEpoch()
    const seq = againSeqRef.current + 1
    againSeqRef.current = seq
    sendReliable({ type: 'again', seq })
    // 对方若同时点了回大厅，hub-return 会 bump epoch；不再本地开新局
    if (epoch !== getHubNavEpoch()) {
      setError('对方已回大厅')
      return
    }
    resetMatch()
  }

  function onData(raw: unknown) {
    if (!isWire(raw)) return

    if (raw.type === 'hello') {
      setPeerWho(raw.who)
      if (!sessionRef.current?.isHost) {
        const mine = otherAbout(raw.who)
        if (whoRef.current !== mine) {
          whoRef.current = mine
          setWho(mine)
        }
        applyDigitLen(raw.digits)
        hello()
      } else if (secretLockedRef.current) {
        // 房主不回 hello（避免乒乓），只补发就绪：后提交方常错过第一包 secret-ready
        peerLog('猜数字：房主补发 secret-ready', raw.who)
        sendSecretReady()
      }
      return
    }

    if (raw.type === 'digits') {
      if (sessionRef.current?.isHost || isHostRef.current) return
      applyDigitLen(raw.digits)
      return
    }

    if (raw.type === 'secret-ready') {
      if (raw.digits !== digitsRef.current) return
      markPeerReady('secret-ready')
      return
    }

    if (raw.type === 'guess') {
      const hits = countHits(secretRef.current, raw.guess)
      if (!secretLockedRef.current || hits == null) {
        send({
          type: 'guess-result',
          requestId: raw.requestId,
          guess: raw.guess,
          hits: -1,
        })
        return
      }
      markPeerReady('guess')
      send({
        type: 'guess-result',
        requestId: raw.requestId,
        guess: raw.guess,
        hits,
      })
      return
    }

    if (raw.type === 'guess-result') {
      if (raw.hits < 0) {
        setGuessBusy(false)
        if (secretLockedRef.current) {
          resetMatch('位数已经变了，请重新出题')
        }
        return
      }
      if (!secretLockedRef.current) {
        setGuessBusy(false)
        return
      }
      markPeerReady('guess-result')
      const next: GuessResult = {
        guess: raw.guess,
        hits: raw.hits,
        at: Date.now(),
      }
      const merged = [...myGuessesRef.current, next]
      myGuessesRef.current = merged
      setMyGuesses(merged)
      send({ type: 'progress', guesses: merged })
      setGuessBusy(false)
      setDraftGuess('')
      if (raw.hits === raw.guess.length && raw.guess.length === digitsRef.current) {
        setISolved(true)
        send({ type: 'solved', turns: merged.length })
        setStatus('你猜中了 · 等对方也猜中后比轮次')
      }
      return
    }

    if (raw.type === 'progress') {
      if (!secretLockedRef.current) return
      markPeerReady('progress')
      setPeerGuesses(raw.guesses)
      return
    }

    if (raw.type === 'solved') {
      if (!secretLockedRef.current) return
      setPeerSolved(true)
      if (typeof raw.turns === 'number' && raw.turns >= 0) {
        setPeerTurns(raw.turns)
      }
      setStatus(
        iSolvedRef.current
          ? '两边都猜中了，正在比轮次…'
          : '对方猜中了 · 等你也猜中后比轮次',
      )
      return
    }

    if (raw.type === 'again') {
      if (!Number.isInteger(raw.seq) || raw.seq <= againSeqRef.current) return
      againSeqRef.current = raw.seq
      resetMatch()
    }
  }

  function roomHandlers() {
    return {
      onData,
      onOpen: () => markLinked(),
      onWake: () => {
        if (linkedRef.current) hello()
      },
      onDisconnect: () => {
        linkedRef.current = false
        setLinked(false)
        setError('连接不稳，正在重连…')
        setStatus('连接不稳，正在重连…')
      },
      onClose: () => {
        linkedRef.current = false
        setLinked(false)
        setError('对方断开了')
        setStatus('连接断开了')
      },
    }
  }

  function navHandlers(handlers: RoomHandlers) {
    return withHubNav(handlers, {
      navigate,
      hereGame: 'guess',
      getMeta: () => ({
        code: roomCodeRef.current || room.code,
        role: isHostRef.current ? 'host' : 'joiner',
        who: whoRef.current,
      }),
      onLocalLeave: () => {
        // 远程跟进不置 leavingHubRef，否则导航失败会卡死「回大厅」
        sessionRef.current = null
      },
    })
  }

  function adoptSession(session: RoomSession, kickOpen: boolean) {
    sessionRef.current = session
    room.attachSession(session, { who: whoRef.current })
    room.bindHandlers(navHandlers(roomHandlers()))
    isHostRef.current = session.isHost
    setIsHost(session.isHost)
    roomCodeRef.current = session.code
    setRoomCode(session.code)
    persistRoom(session.isHost ? 'host' : 'joiner', session.code)
    setPhase(secretLockedRef.current ? 'wait' : 'secret')
    if (kickOpen && session.conn?.open) {
      markLinked()
      return
    }
    if (session.conn?.open) {
      linkedRef.current = true
      setLinked(true)
      setStatus(
        secretLockedRef.current
          ? '已重新连上，等待双方就绪'
          : '已进入房间，先写你的数字',
      )
      return
    }
    linkedRef.current = false
    setLinked(false)
    setStatus(
      session.isHost
        ? `房间 ${session.code} · 等对方进房后一起写数字`
        : '正在连对方…',
    )
  }

  async function create(existingCode: string) {
    setBusy(true)
    setError('')
    try {
      const handlers = navHandlers(roomHandlers())
      const live = await adoptParkedSession(existingCode, true, handlers)
      if (live) {
        adoptSession(live, true)
        return
      }
      sessionRef.current?.destroy()
      sessionRef.current = null
      await releaseParkedRoom(existingCode)
      const session = await createPeerRoom(handlers, { code: existingCode })
      adoptSession(session, false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '开房失败')
      setPhase('lobby')
      setStatus('开房失败')
    } finally {
      setBusy(false)
    }
  }

  async function join(room: string) {
    setBusy(true)
    setError('')
    try {
      const handlers = navHandlers(roomHandlers())
      const live = await adoptParkedSession(room, false, handlers)
      if (live) {
        adoptSession(live, true)
        return
      }
      sessionRef.current?.destroy()
      sessionRef.current = null
      await releaseParkedRoom(room)
      const session = await joinPeerRoom(room, handlers)
      adoptSession(session, false)
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message}。可点重试，或回大厅重新开房`
          : '加入失败。可点重试，或回大厅重新开房',
      )
      setPhase('lobby')
      setStatus('加入失败')
    } finally {
      setBusy(false)
    }
  }

  function retryResume() {
    const saved = resumeSavedRef.current
    if (!saved) return
    setBusy(true)
    setError('')
    setStatus(`正在回到房间 ${saved.code}…`)
    applySavedIdentity(saved)
    if (saved.role === 'host') void create(saved.code)
    else void join(saved.code)
  }

  async function goHub() {
    if (leavingHubRef.current) return
    leavingHubRef.current = true
    const roomCode = roomCodeRef.current || room.code
    if (!roomCode) {
      clearPeerRoom('guess')
      navigate('/games', { replace: true })
      return
    }
    setBusy(true)
    setError('')
    setStatus('正在回房间…')
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

  function lockSecret() {
    if (!isValidNumber(secret, digits)) {
      setError(`要 ${digits} 位数字`)
      return
    }
    // 跟进后补发的 hub-pick 曾误清 sessionRef；以 Provider 会话为准
    if (!sessionRef.current && room.session) {
      sessionRef.current = room.session
    }
    if (!isConnOpen() && !linkedRef.current) {
      setError('还没连上对方')
      return
    }
    setError('')
    setSecretLocked(true)
    secretLockedRef.current = true
    patchPeerRoom({
      secret,
      secretLocked: true,
      digits,
      who,
    })
    sendSecretReady()
    hello()
    if (peerReadyRef.current) {
      setPhase('play')
      setStatus('开始猜吧，两边可以同时猜')
    } else {
      setPhase('wait')
      setStatus('已提交，等待对方提交')
    }
  }

  function submitGuess() {
    if (guessBusy) return
    if (!isValidNumber(draftGuess, digits)) {
      setError(`猜测也要 ${digits} 位数字`)
      return
    }
    if (myGuesses.some((g) => g.guess === draftGuess)) {
      setError('这组已经猜过了')
      return
    }
    if (!sessionRef.current && room.session) {
      sessionRef.current = room.session
    }
    if (!isConnOpen() && !linkedRef.current) {
      setError('连接断开了')
      return
    }
    setError('')
    setGuessBusy(true)
    send({
      type: 'guess',
      guess: draftGuess,
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    })
  }

  return (
    <GameShell
      title="猜数字"
      onBackToHub={phase === 'lobby' ? undefined : () => void goHub()}
      backBusy={busy}
    >
      {phase === 'lobby' ? (
        <EnterRoomGate
          busy={busy}
          status={status}
          error={busy ? undefined : error}
          onRetry={resumeSavedRef.current ? () => retryResume() : undefined}
        />
      ) : null}

      {phase !== 'lobby' && roomCode ? (
        <RoomBanner
          code={roomCode}
          detail={
            peerWho
              ? `${digits} 位 · ${aboutLabel(who)} · ${aboutLabel(peerWho)}`
              : linked
                ? `${digits} 位数 · 已连上`
                : `${digits} 位数 · 等对方`
          }
        />
      ) : null}

      {phase !== 'lobby' ? (
        <p className="mb-5 text-sm text-[var(--ink-soft)]">{status}</p>
      ) : null}

      {(phase === 'secret' || phase === 'wait') && !secretLocked ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-[var(--ink-soft)]">位数</span>
            <div className="wall-filter">
              {([4, 5] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={digits === n ? 'is-on' : ''}
                  disabled={!isHost && !!peerWho}
                  onClick={() => {
                    if (!isHost && peerWho) return
                    if (n === digitsRef.current) return
                    applyDigitLen(n)
                    sendReliable({ type: 'digits', digits: n })
                  }}
                >
                  {n} 位
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm text-[var(--ink-soft)]">
            你的数字（{digits} 位）
          </label>
          <input
            value={secret}
            onChange={(e) =>
              setSecret(e.target.value.replace(/\D/g, '').slice(0, digits))
            }
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={digits}
            placeholder="你的数字"
            className="w-full bg-white/70 px-3 py-4 text-center font-display text-4xl tracking-[0.4em] outline-none ring-1 ring-[var(--leaf)]/20 focus:ring-[var(--leaf)]/45 placeholder:tracking-normal placeholder:text-base placeholder:text-[var(--ink-soft)]"
          />
          <button
            type="button"
            onClick={lockSecret}
            disabled={!linked}
            className="w-full bg-[var(--leaf)] px-4 py-3.5 text-[var(--foam)] disabled:opacity-50"
          >
            {linked ? '提交' : '等对方进房后提交'}
          </button>
        </div>
      ) : null}

      {phase === 'wait' && secretLocked ? (
        <div className="space-y-6 py-6 text-center">
          <MySecret digits={digits} secret={secret} />
          <p className="text-sm text-[var(--ink-soft)]">已提交，等对方…</p>
        </div>
      ) : null}

      {(phase === 'play' || phase === 'done') && (
        <div className="space-y-5">
          <MySecret digits={digits} secret={secret} />

          {phase === 'done' ? (
            <>
              <GuessOutcome
                myTurns={myGuesses.length}
                peerTurns={peerTurns ?? peerGuesses.length}
              />
              <div className="space-y-2">
                {isHost ? (
                  <button
                    type="button"
                    className="game-btn game-btn-leaf w-full"
                    onClick={playAgain}
                  >
                    再来一局
                  </button>
                ) : (
                  <p className="text-center text-sm text-[var(--ink-soft)]">
                    等开房的人再来一局
                  </p>
                )}
              </div>
            </>
          ) : null}

          {phase === 'play' && !iSolved ? (
            <div className="flex gap-2">
              <input
                value={draftGuess}
                onChange={(e) =>
                  setDraftGuess(e.target.value.replace(/\D/g, '').slice(0, digits))
                }
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={digits}
                placeholder="猜"
                className="min-w-0 flex-1 bg-white/70 px-3 py-3.5 text-center font-display text-2xl tracking-[0.35em] outline-none ring-1 ring-[var(--leaf)]/20 focus:ring-[var(--leaf)]/45"
              />
              <button
                type="button"
                disabled={guessBusy}
                onClick={submitGuess}
                className="shrink-0 bg-[var(--leaf)] px-5 py-3.5 text-[var(--foam)] disabled:opacity-50"
              >
                {guessBusy ? '…' : '猜'}
              </button>
            </div>
          ) : null}

          {phase === 'play' && iSolved && !peerSolved ? (
            <p className="text-center text-sm text-[var(--ink-soft)]">
              你已猜中，等对方…（比的是谁轮次更少）
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <GuessList title="你猜过的" guesses={myGuesses} />
            <GuessList title="对方猜过的" guesses={peerGuesses} />
          </div>
        </div>
      )}

      {phase !== 'lobby' && error ? (
        <p className="mt-4 text-sm text-red-700">{error}</p>
      ) : null}
    </GameShell>
  )
}

function GuessOutcome({
  myTurns,
  peerTurns,
}: {
  myTurns: number
  peerTurns: number
}) {
  const result =
    myTurns < peerTurns ? 'win' : myTurns > peerTurns ? 'lose' : 'draw'
  const title =
    result === 'win' ? '你赢了' : result === 'lose' ? '对方赢了' : '平局'

  return (
    <div
      className={[
        'guess-outcome',
        result === 'win' ? 'is-win' : '',
        result === 'draw' ? 'is-draw' : '',
        result === 'lose' ? 'is-lose' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="guess-outcome-title font-display">{title}</p>
      <p className="guess-outcome-meta">
        你 {myTurns} 轮 · 对方 {peerTurns} 轮
      </p>
      {result === 'win' ? <span className="guess-outcome-burst" aria-hidden /> : null}
    </div>
  )
}

function MySecret({ digits, secret }: { digits: DigitLen; secret: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/55 px-3 py-2.5">
      <span className="text-xs text-[var(--ink-soft)]">我出的题（{digits} 位）</span>
      <span className="font-display tracking-[0.28em] text-[var(--ink)]">{secret}</span>
    </div>
  )
}

function GuessList({ title, guesses }: { title: string; guesses: GuessResult[] }) {
  return (
    <div>
      <h2 className="text-xs tracking-wider text-[var(--ink-soft)]">{title}</h2>
      <ul className="mt-2 max-h-64 space-y-1.5 overflow-auto text-sm">
        {guesses.length === 0 ? (
          <li className="text-[var(--ink-soft)]">还没有</li>
        ) : (
          [...guesses].reverse().map((g) => (
            <li
              key={`${g.guess}-${g.at}`}
              className="flex items-center justify-between rounded-lg bg-white/50 px-2.5 py-1.5"
            >
              <span className="font-display tracking-[0.15em]">{g.guess}</span>
              <span className="text-[var(--leaf)]">{formatHits(g.hits)}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
