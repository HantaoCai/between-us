import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnterRoomGate } from '../components/EnterRoomGate'
import { GameShell } from '../components/GameShell'
import { RoomBanner } from '../components/PeerLobby'
import { SpectatorBanner } from '../components/SpectatorBanner'
import {
  countHits,
  DIGIT_LENS,
  formatHits,
  isDigitLen,
  isValidNumber,
  matchOutcomeStatus,
  matchWinCheer,
  resolveGuessMatch,
  type DigitLen,
  type GuessResult,
} from '../lib/guessGame'
import { getHubNavEpoch, leaveGameToHub } from '../lib/hubNav'
import {
  applyPeerHelloIdentity,
  usePeerReenter,
  wrapGameHandlers,
} from '../lib/gameSession'
import { aboutLabel, type NoteAbout } from '../lib/notes'
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
  isSavedGuessRound,
  patchPeerRoom,
  peerRoomMeta,
  readPeerRoom,
  savePlayPeerRoom,
  useFlushPeerRoomOnLeave,
  type SavedGuessRound,
  type SavedPeerRoom,
} from '../lib/peerRoomSave'
import { useGamePeerBoot } from '../lib/useGamePeerBoot'

type Phase = 'lobby' | 'secret' | 'wait' | 'play' | 'done'

type WireMessage =
  | { type: 'hello'; who: NoteAbout; digits: DigitLen }
  | { type: 'digits'; digits: DigitLen }
  | { type: 'secret-ready'; digits: DigitLen }
  /** 旁观上帝视角用；对战端不展示对方 secret */
  | { type: 'secret-share'; who: NoteAbout; secret: string; digits: DigitLen }
  | { type: 'guess'; guess: string; requestId: string }
  | {
      type: 'guess-result'
      requestId: string
      guess: string
      hits: number
    }
  | { type: 'progress'; guesses: GuessResult[] }
  | { type: 'solved'; turns: number }
  | { type: 'need-sync' }
  | { type: 'again'; seq: number }

function isWire(raw: unknown): raw is WireMessage {
  return !!raw && typeof raw === 'object' && 'type' in raw
}

export function GuessPage() {
  const navigate = useNavigate()
  const room = usePeerRoom()
  const spectating = !!room.isSpectator
  const spectatingRef = useRef(spectating)
  spectatingRef.current = spectating
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  /** 旁观上帝视角：双方秘密 */
  const [godSecrets, setGodSecrets] = useState<Partial<Record<NoteAbout, string>>>(
    {},
  )
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
  const peerGuessesRef = useRef<GuessResult[]>([])
  const whoRef = useRef(who)
  const digitsRef = useRef(digits)
  const secretLockedRef = useRef(false)
  const peerReadyRef = useRef(false)
  const roomCodeRef = useRef(roomCode)
  const isHostRef = useRef(false)
  const iSolvedRef = useRef(false)
  const peerSolvedRef = useRef(false)
  const peerTurnsRef = useRef<number | null>(null)
  const againSeqRef = useRef(0)
  const linkedRef = useRef(false)
  const leavingHubRef = useRef(false)
  const resumeSavedRef = useRef<SavedPeerRoom | null>(null)
  const peerOpsRef = useRef({
    create: async (_code: string) => {},
    join: async (_code: string) => {},
  })

  secretRef.current = secret
  myGuessesRef.current = myGuesses
  peerGuessesRef.current = peerGuesses
  whoRef.current = who
  digitsRef.current = digits
  secretLockedRef.current = secretLocked
  peerReadyRef.current = peerReady
  iSolvedRef.current = iSolved
  peerSolvedRef.current = peerSolved
  peerTurnsRef.current = peerTurns
  roomCodeRef.current = roomCode
  isHostRef.current = isHost
  linkedRef.current = linked

  const { reenter, reset: resetReenter } = usePeerReenter({
    leavingHubRef,
    getCode: () => roomCodeRef.current || resumeSavedRef.current?.code || '',
    isHost: () => isHostRef.current,
    create: (code) => peerOpsRef.current.create(code),
    join: (code) => peerOpsRef.current.join(code),
    onRetry: (attempt, max) => {
      setBusy(true)
      setError('')
      setStatus(`连接断了，正在重新进房…（${attempt}/${max}）`)
    },
    onGiveUp: () => {
      setBusy(false)
      setPhase('lobby')
      setError('连接断了，可点重试，或让对方也刷新这局')
      setStatus('重连失败')
    },
  })

  usePeerSessionGuard(sessionRef, () => true)

  useEffect(() => {
    if (secretLocked && peerReady && phase === 'wait') {
      setPhase('play')
      setStatus('开始猜吧，两边可以同时猜')
    }
  }, [secretLocked, peerReady, phase])

  // 旁观：收齐双方 secret-share 后进入观看
  useEffect(() => {
    if (!spectating) return
    if (godSecrets.her && godSecrets.me) {
      setPhase((p) => (p === 'play' || p === 'done' ? p : 'play'))
    }
  }, [spectating, godSecrets])

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
    if (phase !== 'play') return
    finishIfSettled()
  }, [iSolved, peerSolved, phase, myGuesses.length, peerGuesses.length, peerTurns])

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!roomCode, () => {
    if (!roomCodeRef.current) return null
    return buildSavedRoom()
  })

  useGamePeerBoot(
    'guess',
    () => {
      adoptLiveFromProvider()
    },
    (saved) => {
      resumeSavedRef.current = saved
      setBusy(true)
      setError('')
      restoreSavedRound(saved)
      setStatus(`正在回到房间 ${saved.code}…`)
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
    // 从大厅点回同一局：恢复猜数进度，避免当成新开
    const saved = readPeerRoom()
    if (
      saved &&
      saved.code === session.code &&
      (isSavedGuessRound(saved.guess) || saved.secret || saved.digits)
    ) {
      restoreSavedRound({ ...saved, who: room.who, role: room.isHost ? 'host' : 'joiner' })
    }
    setBusy(false)
    setError('')
    setPhase(phaseFromState())
    setStatus(statusFromState())
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

  function currentMatch() {
    return resolveGuessMatch({
      iSolved: iSolvedRef.current,
      peerSolved: peerSolvedRef.current,
      myTurns: myGuessesRef.current.length,
      peerTurns: peerTurnsRef.current,
      peerGuessCount: peerGuessesRef.current.length,
    })
  }

  function finishIfSettled() {
    const settled = currentMatch()
    if (!settled) return false
    // 提前胜负时锁定对方轮次，避免后续进度把结果冲掉
    peerTurnsRef.current = settled.peerTurns
    setPeerTurns(settled.peerTurns)
    setStatus(matchOutcomeStatus(settled.outcome, settled.myTurns, settled.peerTurns))
    setPhase('done')
    persistRoom()
    return true
  }

  function phaseFromState(): Phase {
    if (currentMatch()) return 'done'
    if (secretLockedRef.current && peerReadyRef.current) return 'play'
    if (secretLockedRef.current) return 'wait'
    return 'secret'
  }

  function statusFromState(): string {
    const settled = currentMatch()
    if (settled) {
      return matchOutcomeStatus(settled.outcome, settled.myTurns, settled.peerTurns)
    }
    if (iSolvedRef.current) {
      return '你猜中了 · 对方轮次一旦追不上，你就提前赢'
    }
    if (peerSolvedRef.current) {
      return '对方猜中了 · 你要用更少轮次才赶得上'
    }
    if (secretLockedRef.current && peerReadyRef.current) {
      return '开始猜吧，两边可以同时猜'
    }
    if (secretLockedRef.current) return '已提交，等待对方提交'
    return '已连上，先各自写一个数字'
  }

  function buildGuessRound(): SavedGuessRound | null {
    if (!secretLockedRef.current && !secretRef.current) return null
    return {
      digits: digitsRef.current,
      secret: secretRef.current,
      secretLocked: secretLockedRef.current,
      peerReady: peerReadyRef.current,
      myGuesses: myGuessesRef.current,
      peerGuesses: peerGuessesRef.current,
      iSolved: iSolvedRef.current,
      peerSolved: peerSolvedRef.current,
      peerTurns: peerTurnsRef.current,
    }
  }

  function buildSavedRoom(): Omit<SavedPeerRoom, 'savedAt'> | null {
    if (!roomCodeRef.current) return null
    return {
      ...peerRoomMeta({
        game: 'guess',
        code: roomCodeRef.current,
        role: isHostRef.current ? 'host' : 'joiner',
        who: whoRef.current,
      }),
      guess: buildGuessRound(),
    }
  }

  function persistRoom(role?: 'host' | 'joiner', code?: string) {
    if (code) roomCodeRef.current = code
    if (role) isHostRef.current = role === 'host'
    if (!roomCodeRef.current) return
    savePlayPeerRoom(
      {
        game: 'guess',
        code: roomCodeRef.current,
        role: isHostRef.current ? 'host' : 'joiner',
        who: whoRef.current,
      },
      { guess: buildGuessRound() },
    )
  }

  function restoreSavedRound(saved: SavedPeerRoom) {
    whoRef.current = saved.who
    setWho(saved.who)
    roomCodeRef.current = saved.code
    setRoomCode(saved.code)
    isHostRef.current = saved.role === 'host'
    setIsHost(saved.role === 'host')
    const round = isSavedGuessRound(saved.guess)
      ? saved.guess
      : legacyGuessRound(saved)
    if (!round) {
      setPhase('secret')
      return
    }
    digitsRef.current = round.digits
    setDigits(round.digits)
    secretRef.current = round.secret
    setSecret(round.secret)
    secretLockedRef.current = round.secretLocked
    setSecretLocked(round.secretLocked)
    peerReadyRef.current = round.peerReady
    setPeerReady(round.peerReady)
    myGuessesRef.current = round.myGuesses
    setMyGuesses(round.myGuesses)
    peerGuessesRef.current = round.peerGuesses
    setPeerGuesses(round.peerGuesses)
    iSolvedRef.current = round.iSolved
    setISolved(round.iSolved)
    peerSolvedRef.current = round.peerSolved
    setPeerSolved(round.peerSolved)
    peerTurnsRef.current = round.peerTurns
    setPeerTurns(round.peerTurns)
    setPhase(phaseFromState())
    setStatus(statusFromState())
  }

  function legacyGuessRound(saved: SavedPeerRoom): SavedGuessRound | null {
    const digits = isDigitLen(saved.digits ?? 0) ? saved.digits! : null
    if (!digits && !saved.secret && !saved.secretLocked) return null
    return {
      digits: digits ?? 4,
      secret: saved.secret ?? '',
      secretLocked: !!saved.secretLocked,
      peerReady: false,
      myGuesses: [],
      peerGuesses: [],
      iSolved: false,
      peerSolved: false,
      peerTurns: null,
    }
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
    resetReenter()
    setPhase((p) => {
      if (p === 'lobby') return phaseFromState()
      // 重连时若本地已有进度，按进度纠正；否则保持当前阶段
      if (secretLockedRef.current || myGuessesRef.current.length > 0) {
        return phaseFromState()
      }
      return p
    })
    setStatus(statusFromState())
    syncRound()
  }

  function syncRound() {
    hello()
    sendReliable({ type: 'need-sync' })
    pushRoundState()
  }

  /** 把本地进度推给对方，刷新后两边对齐 */
  function pushRoundState() {
    if (secretRef.current && secretLockedRef.current) {
      sendSecretReady()
    }
    if (myGuessesRef.current.length > 0) {
      sendReliable({ type: 'progress', guesses: myGuessesRef.current })
    }
    if (iSolvedRef.current) {
      sendReliable({ type: 'solved', turns: myGuessesRef.current.length })
    }
  }

  function resetMatch(status?: string) {
    secretRef.current = ''
    secretLockedRef.current = false
    peerReadyRef.current = false
    myGuessesRef.current = []
    peerGuessesRef.current = []
    iSolvedRef.current = false
    peerSolvedRef.current = false
    peerTurnsRef.current = null
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
      guess: null,
    })
  }

  // 位数变了之后，已经提交的题作废，按新位数重新出题
  function applyDigitLen(n: number) {
    if (!isDigitLen(n)) return
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
    persistRoom()
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
      resetReenter()
      const isHostNow = !!sessionRef.current?.isHost
      applyPeerHelloIdentity({
        peerWho: raw.who,
        isHost: isHostNow,
        whoRef,
        setWho,
        setPeerWho,
        // 猜数字房主不回 hello，避免乒乓
      })
      if (!isHostNow) {
        applyDigitLen(raw.digits)
        pushRoundState()
      } else {
        peerLog('猜数字：房主补发进度', raw.who)
        pushRoundState()
      }
      return
    }

    if (raw.type === 'need-sync') {
      pushRoundState()
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
      persistRoom()
      return
    }

    if (raw.type === 'secret-share') {
      if (raw.digits !== digitsRef.current) return
      // 仅旁观收录；对战端不展示对方数字
      if (spectatingRef.current) {
        setGodSecrets((prev) => ({ ...prev, [raw.who]: raw.secret }))
        markPeerReady('secret-share')
      }
      return
    }

    if (raw.type === 'guess') {
      if (spectatingRef.current) return
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
        iSolvedRef.current = true
        setISolved(true)
        send({ type: 'solved', turns: merged.length })
        if (!finishIfSettled()) {
          setStatus('你猜中了 · 对方轮次一旦追不上，你就提前赢')
        }
      }
      persistRoom()
      return
    }

    if (raw.type === 'progress') {
      if (spectatingRef.current) return
      if (!secretLockedRef.current) return
      markPeerReady('progress')
      peerGuessesRef.current = raw.guesses
      setPeerGuesses(raw.guesses)
      if (!finishIfSettled()) persistRoom()
      return
    }

    if (raw.type === 'solved') {
      if (spectatingRef.current) {
        setStatus('有人猜中了')
        return
      }
      if (!secretLockedRef.current) return
      peerSolvedRef.current = true
      setPeerSolved(true)
      if (typeof raw.turns === 'number' && raw.turns >= 0) {
        peerTurnsRef.current = raw.turns
        setPeerTurns(raw.turns)
      }
      if (!finishIfSettled()) {
        setStatus(
          iSolvedRef.current
            ? '两边都猜中了，正在比轮次…'
            : '对方猜中了 · 你要用更少轮次才赶得上',
        )
        persistRoom()
      }
      return
    }

    if (raw.type === 'again') {
      if (!Number.isInteger(raw.seq) || raw.seq <= againSeqRef.current) return
      againSeqRef.current = raw.seq
      setGodSecrets({})
      resetMatch()
    }
  }

  function roomHandlers() {
    return {
      onData,
      onOpen: () => markLinked(),
      onWake: () => {
        if (linkedRef.current) syncRound()
      },
      onDisconnect: () => {
        linkedRef.current = false
        setLinked(false)
        setError('对方暂时离开，你仍可操作；连上后会自动同步进度')
        setStatus('对方暂时离开，你仍可操作；连上后会自动同步进度')
      },
      onPeerLost: () => reenter(),
      onClose: () => {
        linkedRef.current = false
        setLinked(false)
        setError('对方断开了')
        setStatus('连接断开了')
      },
    }
  }

  function navHandlers(handlers: RoomHandlers) {
    return wrapGameHandlers(handlers, {
      hereGame: 'guess',
      navigate,
      room,
      getMeta: () => ({
        code: roomCodeRef.current || room.code,
        role: isHostRef.current ? 'host' : 'joiner',
        who: whoRef.current,
      }),
      onLocalLeave: () => {
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
    resetReenter()
    persistRoom(session.isHost ? 'host' : 'joiner', session.code)
    setPhase(phaseFromState())
    if (kickOpen && session.conn?.open) {
      markLinked()
      return
    }
    if (session.conn?.open) {
      markLinked()
      return
    }
    linkedRef.current = false
    setLinked(false)
    setStatus(
      session.isHost
        ? secretLockedRef.current
          ? `房间 ${session.code} · 已恢复本局，等对方重连`
          : `房间 ${session.code} · 等对方进房后一起写数字`
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
      const msg = e instanceof Error ? e.message : '开房失败'
      setError(msg)
      // 刷新后房号常要等信令释放；有房间号就自动重试，而不是卡在大厅
      if (!leavingHubRef.current && (resumeSavedRef.current || roomCodeRef.current)) {
        setStatus('房间号还在释放，正在重试…')
        reenter()
        return
      }
      setPhase('lobby')
      setStatus('开房失败')
    } finally {
      setBusy(false)
    }
  }

  async function join(code: string) {
    setBusy(true)
    setError('')
    try {
      const handlers = navHandlers(roomHandlers())
      const live = await adoptParkedSession(code, false, handlers)
      if (live) {
        adoptSession(live, true)
        return
      }
      sessionRef.current?.destroy()
      sessionRef.current = null
      await releaseParkedRoom(code)
      const session = await joinPeerRoom(code, handlers)
      adoptSession(session, false)
    } catch (e) {
      const msg =
        e instanceof Error
          ? `${e.message}。可点重试，或回大厅重新开房`
          : '加入失败。可点重试，或回大厅重新开房'
      setError(msg)
      if (!leavingHubRef.current && (resumeSavedRef.current || roomCodeRef.current)) {
        setStatus('暂时连不上，正在重试…')
        reenter()
        return
      }
      setPhase('lobby')
      setStatus('加入失败')
    } finally {
      setBusy(false)
    }
  }

  peerOpsRef.current = { create, join }

  function retryResume() {
    const saved = resumeSavedRef.current
    if (!saved) return
    resetReenter()
    setBusy(true)
    setError('')
    setStatus(`正在回到房间 ${saved.code}…`)
    restoreSavedRound(saved)
    if (saved.role === 'host') void create(saved.code)
    else void join(saved.code)
  }

  async function goHub() {
    if (leavingHubRef.current) return
    leavingHubRef.current = true
    resetReenter()
    const roomCode = roomCodeRef.current || room.code
    if (!roomCode) {
      clearPeerRoom('guess')
      navigate('/games', { replace: true })
      return
    }
    setBusy(true)
    setError('')
    setStatus('正在回房间…')
    persistRoom()
    await leaveGameToHub({
      sendReliable: (data, times) => room.sendReliable(data, times),
      code: roomCode,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
      navigate,
      fromGame: 'guess',
      onLocalLeave: () => {
        sessionRef.current = null
      },
    })
  }

  function lockSecret() {
    if (spectatingRef.current) return
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
    persistRoom()
    sendSecretReady()
    sendReliable({
      type: 'secret-share',
      who: whoRef.current,
      secret: secretRef.current,
      digits: digitsRef.current,
    })
    hello()
    if (peerReadyRef.current) {
      setPhase('play')
      setStatus('开始猜吧，两边可以同时猜')
    } else {
      setPhase('wait')
      setStatus('已提交，等待对方提交')
    }
  }

  function submitGuess(rawGuess?: string) {
    if (spectatingRef.current) return
    if (guessBusy) return
    const guess = (rawGuess ?? draftGuess).replace(/\D/g, '').slice(0, digits)
    if (!isValidNumber(guess, digits)) {
      setError(`猜测也要 ${digits} 位数字`)
      return
    }
    if (myGuesses.some((g) => g.guess === guess)) {
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
    setDraftGuess(guess)
    send({
      type: 'guess',
      guess,
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    })
  }

  const inMatch = phase === 'play' || phase === 'done' || phase === 'wait'
  const metaLine = spectating
    ? phase === 'play' || phase === 'done'
      ? `${digits} 位 · 旁观`
      : `${digits} 位 · 等双方出题`
    : peerWho
      ? `${digits} 位 · ${aboutLabel(who)}/${aboutLabel(peerWho)} · ${status}`
      : linked
        ? `${digits} 位 · ${status}`
        : `${digits} 位 · 等对方`

  return (
    <GameShell
      title="猜数字"
      compact={inMatch}
      dense={inMatch}
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

      {phase !== 'lobby' ? (
        <div className={inMatch ? 'guess-screen' : undefined}>
          {phase === 'secret' && roomCode ? (
            <RoomBanner
              code={roomCode}
              detail={
                spectating
                  ? `${digits} 位 · 旁观`
                  : peerWho
                    ? `${digits} 位 · ${aboutLabel(who)} · ${aboutLabel(peerWho)}`
                    : linked
                      ? `${digits} 位数 · 已连上`
                      : `${digits} 位数 · 等对方`
              }
            />
          ) : null}

          {inMatch ? <p className="guess-meta">{metaLine}</p> : null}

          {spectating ? (
            <div className="mb-1">
              <SpectatorBanner />
            </div>
          ) : null}

          {spectating && (phase === 'secret' || phase === 'wait') ? (
            <div className="space-y-2 py-1 text-center text-sm text-[var(--ink-soft)]">
              <p>上帝视角：双方提交后显示数字</p>
              <div className="guess-god-row">
                {(['her', 'me'] as const).map((side) => (
                  <div key={side} className="guess-god-chip">
                    <span>{aboutLabel(side)}</span>
                    <strong className="font-display">
                      {godSecrets[side] || '…'}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {!spectating && (phase === 'secret' || phase === 'wait') && !secretLocked ? (
            <div className="space-y-3">
              {phase === 'secret' ? (
                <p className="text-sm text-[var(--ink-soft)]">{status}</p>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--ink-soft)]">位数</span>
                <div className="wall-filter">
                  {DIGIT_LENS.map((n) => (
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
                className="w-full bg-white/70 px-3 py-3 text-center font-display text-3xl tracking-[0.4em] outline-none ring-1 ring-[var(--leaf)]/20 focus:ring-[var(--leaf)]/45 placeholder:tracking-normal placeholder:text-base placeholder:text-[var(--ink-soft)]"
              />
              <button
                type="button"
                onClick={lockSecret}
                disabled={!linked}
                className="w-full bg-[var(--leaf)] px-4 py-3 text-[var(--foam)] disabled:opacity-50"
              >
                {linked ? '提交' : '等对方进房后提交'}
              </button>
            </div>
          ) : null}

          {!spectating && phase === 'wait' && secretLocked ? (
            <div className="space-y-2 py-3 text-center">
              <MySecret digits={digits} secret={secret} compact />
              <p className="text-sm text-[var(--ink-soft)]">已提交，等对方…</p>
            </div>
          ) : null}

          {(phase === 'play' || phase === 'done') && (
            <div className="guess-play">
              {spectating ? (
                <div className="guess-god-row">
                  {(['her', 'me'] as const).map((side) => (
                    <div key={side} className="guess-god-chip">
                      <span>{aboutLabel(side)}</span>
                      <strong className="font-display">
                        {godSecrets[side] || '—'}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <MySecret digits={digits} secret={secret} compact />
              )}

              {phase === 'done' ? (
                <>
                  <GuessOutcome
                    myTurns={myGuesses.length}
                    peerTurns={peerTurns ?? peerGuesses.length}
                    iSolved={iSolved}
                    peerSolved={peerSolved}
                  />
                  <div>
                    {spectating ? (
                      <p className="text-center text-sm text-[var(--ink-soft)]">
                        旁观中，等他们再来一局
                      </p>
                    ) : isHost ? (
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

              {!spectating && phase === 'play' && !iSolved ? (
                <GuessWorkbench
                  key={`wb-${digits}-${againSeqRef.current}`}
                  digits={digits}
                  guessCount={myGuesses.length}
                  onSubmit={submitGuess}
                  busy={guessBusy}
                />
              ) : null}

              {!spectating && phase === 'play' && iSolved && !peerSolved ? (
                <p className="text-center text-xs text-[var(--ink-soft)]">
                  你已猜中（{myGuesses.length} 轮）。对方已猜{' '}
                  {peerTurns ?? peerGuesses.length} 轮；一旦不少于你，你就提前赢
                </p>
              ) : null}

              {spectating ? (
                <p className="text-center text-xs text-[var(--ink-soft)]">
                  旁观只展示双方数字
                </p>
              ) : (
                <div className="guess-history">
                  <GuessList title="你" guesses={myGuesses} />
                  <GuessList title="对方" guesses={peerGuesses} />
                </div>
              )}
            </div>
          )}

          {error ? <p className="guess-error text-sm text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </GameShell>
  )
}

function GuessOutcome({
  myTurns,
  peerTurns,
  iSolved,
  peerSolved,
}: {
  myTurns: number
  peerTurns: number
  iSolved: boolean
  peerSolved: boolean
}) {
  const settled =
    resolveGuessMatch({
      iSolved,
      peerSolved,
      myTurns,
      peerTurns,
      peerGuessCount: peerTurns,
    }) ??
    (myTurns < peerTurns
      ? { outcome: 'win' as const, myTurns, peerTurns }
      : myTurns > peerTurns
        ? { outcome: 'lose' as const, myTurns, peerTurns }
        : { outcome: 'draw' as const, myTurns, peerTurns })
  const result = settled.outcome
  const title =
    result === 'win' ? '你赢了' : result === 'lose' ? '对方赢了' : '平局'
  const cheer =
    result === 'win'
      ? matchWinCheer(settled.myTurns, settled.peerTurns)
      : result === 'draw'
        ? '心有灵犀，轮次一样多'
        : iSolved
          ? '这局差一点点，再来挑战一次'
          : '对方更早更少轮猜中，这局先到这里'

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
      <p className="guess-outcome-cheer">{cheer}</p>
      <p className="guess-outcome-meta">
        你 {settled.myTurns} 轮 · 对方 {settled.peerTurns} 轮
      </p>
      {result === 'win' ? <span className="guess-outcome-burst" aria-hidden /> : null}
    </div>
  )
}

function MySecret({
  digits,
  secret,
  compact,
}: {
  digits: DigitLen
  secret: string
  compact?: boolean
}) {
  if (compact) {
    return (
      <p className="guess-my-secret">
        <span>我的题</span>
        <strong className="font-display">{secret}</strong>
        <span>{digits} 位</span>
      </p>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/55 px-3 py-2.5">
      <span className="text-xs text-[var(--ink-soft)]">我出的题（{digits} 位）</span>
      <span className="font-display tracking-[0.28em] text-[var(--ink)]">{secret}</span>
    </div>
  )
}

function emptySlots(n: number): Array<string | null> {
  return Array.from({ length: n }, () => null)
}

function emptyExcluded(n: number): string[][] {
  return Array.from({ length: n }, () => [])
}

function slotsToGuess(slots: Array<string | null>): string {
  return slots.every((d) => d != null) ? slots.join('') : ''
}

type PadMode = 'fill' | 'exclude' | 'known'

const PAD_MODES: ReadonlyArray<{ id: PadMode; label: string; tip: string }> = [
  { id: 'fill', label: '填入', tip: '点数字，填进当前格' },
  { id: 'exclude', label: '排除', tip: '点数字，表示这一格不是它' },
  { id: 'known', label: '已知', tip: '点数字，锁定这一格（下轮保留）' },
]

/** 本地辅助：按位排除 / 已知锁 / 草稿；不同步给对方 */
function GuessWorkbench({
  digits,
  guessCount,
  onSubmit,
  busy,
}: {
  digits: DigitLen
  guessCount: number
  onSubmit: (guess: string) => void
  busy: boolean
}) {
  const [known, setKnown] = useState<Array<string | null>>(() => emptySlots(digits))
  const [guessSlots, setGuessSlots] = useState<Array<string | null>>(() =>
    emptySlots(digits),
  )
  const [excluded, setExcluded] = useState<string[][]>(() => emptyExcluded(digits))
  const [notes, setNotes] = useState('')
  const [focus, setFocus] = useState(0)
  const [mode, setMode] = useState<PadMode>('fill')
  const prevGuessCount = useRef(guessCount)

  useEffect(() => {
    if (guessCount === prevGuessCount.current) return
    prevGuessCount.current = guessCount
    setGuessSlots(Array.from({ length: digits }, (_, i) => known[i] ?? null))
    const next = known.findIndex((d) => !d)
    setFocus(next >= 0 ? next : 0)
    setMode('fill')
  }, [guessCount, digits, known])

  const displaySlots = Array.from(
    { length: digits },
    (_, i) => known[i] ?? guessSlots[i] ?? null,
  )
  const focusExcluded = new Set(excluded[focus] ?? [])
  const locked = !!known[focus]
  const modeMeta = PAD_MODES.find((m) => m.id === mode) ?? PAD_MODES[0]

  function advanceFocus(from: number) {
    for (let step = 1; step <= digits; step++) {
      const i = (from + step) % digits
      if (known[i]) continue
      setFocus(i)
      return
    }
    setFocus(from)
  }

  function clearFocused() {
    if (known[focus]) {
      setKnown((prev) => {
        const next = [...prev]
        next[focus] = null
        return next
      })
      return
    }
    setGuessSlots((prev) => {
      const next = [...prev]
      next[focus] = null
      return next
    })
  }

  function unlockFocused() {
    if (!known[focus]) return
    setKnown((prev) => {
      const next = [...prev]
      next[focus] = null
      return next
    })
  }

  function fillDigit(digit: string) {
    if (locked) {
      advanceFocus(focus)
      return
    }
    if (focusExcluded.has(digit)) return
    setGuessSlots((prev) => {
      const next = [...prev]
      next[focus] = digit
      return next
    })
    advanceFocus(focus)
  }

  function excludeDigit(digit: string) {
    if (locked) return
    setExcluded((prev) => {
      const next = prev.map((row) => [...row])
      const row = next[focus] ?? []
      next[focus] = row.includes(digit)
        ? row.filter((d) => d !== digit)
        : [...row, digit]
      return next
    })
    setGuessSlots((prev) => {
      if (prev[focus] !== digit) return prev
      const next = [...prev]
      next[focus] = null
      return next
    })
  }

  function lockDigit(digit: string) {
    if (locked) {
      unlockFocused()
      return
    }
    setKnown((prev) => {
      const next = [...prev]
      next[focus] = digit
      return next
    })
    setGuessSlots((prev) => {
      const next = [...prev]
      next[focus] = digit
      return next
    })
    setExcluded((prev) => {
      const next = prev.map((row) => [...row])
      next[focus] = []
      return next
    })
    setMode('fill')
    advanceFocus(focus)
  }

  function onPadDigit(digit: string) {
    if (mode === 'exclude') {
      excludeDigit(digit)
      return
    }
    if (mode === 'known') {
      lockDigit(digit)
      return
    }
    fillDigit(digit)
  }

  const submitValue = slotsToGuess(displaySlots)
  const canSubmit = isValidNumber(submitValue, digits) && !busy

  return (
    <div className="guess-workbench">
      <div className="guess-guess-row">
        <div className="guess-slots" style={{ '--guess-n': digits } as CSSProperties}>
          {displaySlots.map((d, i) => {
            const isLocked = !!known[i]
            const hasOut = (excluded[i] ?? []).length > 0
            return (
              <button
                key={`g-${i}`}
                type="button"
                className={[
                  'guess-slot',
                  isLocked ? 'is-locked' : '',
                  focus === i ? 'is-focus' : '',
                  d ? 'is-filled' : '',
                  hasOut ? 'has-out' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setFocus(i)}
                aria-label={`第 ${i + 1} 位`}
              >
                {d ?? ''}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit(submitValue)}
          className="guess-submit"
        >
          {busy ? '…' : '猜'}
        </button>
      </div>

      <div className="guess-mode-row">
        <div className="guess-mode-seg" role="tablist" aria-label="键盘用途">
          {PAD_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className={mode === m.id ? 'is-on' : ''}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button type="button" className="guess-workbench-link" onClick={clearFocused}>
          {locked ? '解锁' : '清空'}
        </button>
      </div>

      <p className="guess-mode-tip">
        第 {focus + 1} 格 · {locked ? '已锁定，点「解锁」可改' : modeMeta.tip}
      </p>

      <div className="guess-pad">
        {Array.from({ length: 10 }, (_, n) => String(n)).map((d) => {
          const isOut = focusExcluded.has(d)
          const disabled =
            locked || (mode === 'fill' && isOut)
          return (
            <button
              key={d}
              type="button"
              className={[
                isOut ? 'is-out' : '',
                mode === 'exclude' && isOut ? 'is-mode-out' : '',
                mode === 'known' ? 'is-mode-known' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={disabled}
              onClick={() => onPadDigit(d)}
            >
              {d}
            </button>
          )
        })}
      </div>

      <input
        className="guess-notes-line"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="草稿（本机）"
      />
    </div>
  )
}

function GuessList({ title, guesses }: { title: string; guesses: GuessResult[] }) {
  return (
    <div className="guess-list">
      <h2>{title}</h2>
      <ul>
        {guesses.length === 0 ? (
          <li className="is-empty">还没有</li>
        ) : (
          [...guesses].reverse().map((g) => (
            <li key={`${g.guess}-${g.at}`}>
              <span className="font-display">{g.guess}</span>
              <span>{formatHits(g.hits)}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
