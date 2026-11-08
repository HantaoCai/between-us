import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnterRoomGate } from '../components/EnterRoomGate'
import { GameShell } from '../components/GameShell'
import { RoomBanner } from '../components/PeerLobby'
import { SpectatorBanner } from '../components/SpectatorBanner'
import { suggestNextGuess, type GuessHint } from '../lib/guessAi'
import {
  countHits,
  DIGIT_LENS,
  formatGuessHits,
  isDigitLen,
  isValidNumber,
  matchOutcomeStatus,
  matchWinCheer,
  guessesThroughSolve,
  resolveGuessMatch,
  type DigitLen,
  type GuessResult,
} from '../lib/guessGame'
import {
  clearStashedPeerSecret,
  hasStashedPeerSecret,
  hydratePeerSecret,
  peekStashedPeerSecret,
  scoreAgainstPeerSecret,
  stashPeerSecret,
} from '../lib/guessPeerSecret'
import { createBotDriverForGame } from '../lib/botDrivers'
import { isSoloPlay, isSoloRoomCode } from '../lib/botRoomSession'
import { mountSoloBotSession } from '../lib/bootSoloSession'
import { leaveGameToHub } from '../lib/hubNav'
import {
  applyPeerHelloIdentity,
  usePeerReenter,
  wrapGameHandlers,
} from '../lib/gameSession'
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
type EndReason = 'match' | 'resign'
type RestartAsk = null | 'waiting' | 'decide'

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
  /** 终局公布答案；对战端只在 done 后展示 */
  | { type: 'reveal'; who: NoteAbout; secret: string; digits: DigitLen }
  | { type: 'resign'; who: NoteAbout }
  | { type: 'restart-ask'; seq: number }
  | { type: 'restart-ok'; seq: number }
  | { type: 'restart-no'; seq: number }
  | { type: 'need-sync' }
  /** @deprecated 旧版房主单方再来；仍接收兼容 */
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
  /** 仅终局展示用；对局中的对方题面在 guessPeerSecret 内存库，不进 state/存档 */
  const [peerSecret, setPeerSecret] = useState<string | null>(null)
  const [endReason, setEndReason] = useState<EndReason | null>(null)
  const [resignedBy, setResignedBy] = useState<NoteAbout | null>(null)
  const [restartAsk, setRestartAsk] = useState<RestartAsk>(null)

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
  const endReasonRef = useRef<EndReason | null>(null)
  const resignedByRef = useRef<NoteAbout | null>(null)
  const restartAskRef = useRef<RestartAsk>(null)
  const againSeqRef = useRef(0)
  const linkedRef = useRef(false)
  const leavingHubRef = useRef(false)
  const resumeSavedRef = useRef<SavedPeerRoom | null>(null)
  /** 在途猜测：只挡这一次，不因历史 pending 永久锁死「猜」 */
  const inflightGuessRef = useRef<{
    guess: string
    requestId: string
    timer: number
  } | null>(null)
  const guessBusyRef = useRef(false)
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
  endReasonRef.current = endReason
  resignedByRef.current = resignedBy
  restartAskRef.current = restartAsk
  roomCodeRef.current = roomCode
  isHostRef.current = isHost
  linkedRef.current = linked
  guessBusyRef.current = guessBusy

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

  useEffect(
    () => () => {
      const cur = inflightGuessRef.current
      if (cur) window.clearTimeout(cur.timer)
      inflightGuessRef.current = null
    },
    [],
  )

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

  // 卡在「等对方提交」时持续补发就绪与题面：对方若先一步进猜数，第一包很容易丢
  useEffect(() => {
    if (phase !== 'wait' || !secretLocked) return
    const tick = () => {
      if (!secretLockedRef.current || !secretRef.current) return
      if (!isConnOpen() && !linkedRef.current) return
      sendSecretReady()
      sendReliable({
        type: 'secret-share',
        who: whoRef.current,
        secret: secretRef.current,
        digits: digitsRef.current,
      })
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
      if (isSoloPlay({ code: room.code, session: room.session })) {
        bootSoloSession(room.who, room.code)
        return
      }
      adoptLiveFromProvider()
    },
    (saved) => {
      resumeSavedRef.current = saved
      setBusy(true)
      setError('')
      restoreSavedRound(saved)
      setStatus(`正在回到房间 ${saved.code}…`)
      if (saved.mode === 'solo' || isSoloRoomCode(saved.code)) {
        bootSoloSession(saved.who, saved.code)
        return
      }
      if (saved.role === 'host') void create(saved.code)
      else void join(saved.code)
    },
  )

  function bootSoloSession(playerWho: NoteAbout, keepCode?: string) {
    setBusy(true)
    setError('')
    const driver = createBotDriverForGame('guess', {
      botWho: otherAbout(playerWho),
      playerWho,
    })
    const { session, botWho } = mountSoloBotSession({
      room,
      driver,
      playerWho,
      code: keepCode || room.code || resumeSavedRef.current?.code,
      attach: false,
    })
    whoRef.current = playerWho
    setWho(playerWho)
    setPeerWho(botWho)
    adoptSession(session, true)
    setStatus('人机对战 · 先各自写一个数字')
    setBusy(false)
  }

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
    } else {
      void hydrateVaultForRoom(session.code)
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

  function confirmedTurns(guesses: GuessResult[]) {
    return guesses.filter((g) => !g.pending).length
  }

  function currentMatch() {
    return resolveGuessMatch({
      iSolved: iSolvedRef.current,
      peerSolved: peerSolvedRef.current,
      myTurns: confirmedTurns(myGuessesRef.current),
      peerTurns: peerTurnsRef.current,
      peerGuessCount: peerGuessesRef.current.length,
    })
  }

  function publishReveal() {
    if (spectatingRef.current) return
    if (!secretLockedRef.current || !secretRef.current) return
    sendReliable({
      type: 'reveal',
      who: whoRef.current,
      secret: secretRef.current,
      digits: digitsRef.current,
    })
  }

  function finishIfSettled() {
    const settled = currentMatch()
    if (!settled) return false
    // 提前胜负时锁定对方轮次，避免后续进度把结果冲掉
    peerTurnsRef.current = settled.peerTurns
    setPeerTurns(settled.peerTurns)
    endReasonRef.current = 'match'
    setEndReason('match')
    setStatus(matchOutcomeStatus(settled.outcome, settled.myTurns, settled.peerTurns))
    setPhase('done')
    setRestartAsk(null)
    restartAskRef.current = null
    revealPeerSecretForDisplay()
    publishReveal()
    persistRoom()
    return true
  }

  function phaseFromState(): Phase {
    if (endReasonRef.current === 'resign' || currentMatch()) return 'done'
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
      // 对局中不落盘对方题面；终局才存展示用答案（从内存库取，避免 setState 未刷）
      peerSecret:
        endReasonRef.current || currentMatch()
          ? peekStashedPeerSecret(roomCodeRef.current)
          : null,
      endReason: endReasonRef.current,
      resignedBy: resignedByRef.current,
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
        mode: isSoloPlay({ code: roomCodeRef.current, session: room.session })
          ? 'solo'
          : 'peer',
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
      void hydrateVaultForRoom(saved.code)
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
    if (round.peerSecret) {
      const finished =
        !!round.endReason || (round.iSolved && round.peerSolved)
      if (finished) {
        setPeerSecret(round.peerSecret)
      } else {
        // 旧存档若误带了题面：只进内存库供离线判分，不进 UI state
        stashPeerSecret(saved.code, round.peerSecret)
        setPeerSecret(null)
      }
    } else {
      setPeerSecret(null)
    }
    endReasonRef.current = round.endReason ?? (currentMatch() ? 'match' : null)
    setEndReason(endReasonRef.current)
    resignedByRef.current = round.resignedBy ?? null
    setResignedBy(round.resignedBy ?? null)
    setRestartAsk(null)
    restartAskRef.current = null
    setPhase(phaseFromState())
    setStatus(statusFromState())
    // 刷新后从加密库恢复对方题面，离线仍可接着判「对几位」
    void hydrateVaultForRoom(saved.code)
  }

  async function hydrateVaultForRoom(code: string) {
    const ok = await hydratePeerSecret(code)
    if (!ok) return
    resolvePendingWithPeerSecret()
    if (endReasonRef.current || currentMatch()) {
      revealPeerSecretForDisplay()
    }
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
      peerSecret: null,
      endReason: null,
      resignedBy: null,
    }
  }

  function liveSession() {
    return sessionRef.current ?? room.session
  }

  function isConnOpen() {
    const s = liveSession()
    return !!s?.conn?.open
  }

  function clearInflightGuess() {
    const cur = inflightGuessRef.current
    if (cur) window.clearTimeout(cur.timer)
    inflightGuessRef.current = null
  }

  function setGuessBusyState(on: boolean) {
    guessBusyRef.current = on
    setGuessBusy(on)
  }

  /** 用内存库里的对方题面本地判命中（不把题面暴露给 UI） */
  function localHitsFor(guess: string): number | null {
    return scoreAgainstPeerSecret(roomCodeRef.current, guess)
  }

  /** 写入自己的一次已确认猜测（网络回包或本地离线判分共用） */
  function commitMyGuessResult(guess: string, hits: number) {
    if (!secretLockedRef.current) {
      setGuessBusyState(false)
      return
    }
    const confirmed: GuessResult = {
      guess,
      hits,
      at: Date.now(),
    }
    const withoutDup = myGuessesRef.current.filter(
      (g) => !(g.guess === guess && g.pending),
    )
    const already = withoutDup.some((g) => g.guess === guess && !g.pending)
    const merged = already ? withoutDup : [...withoutDup, confirmed]
    myGuessesRef.current = merged
    setMyGuesses(merged)
    try {
      send({
        type: 'progress',
        guesses: merged.filter((g) => !g.pending),
      })
    } catch {
      /* 离线进度同步失败不挡继续猜 */
    }
    setGuessBusyState(!!inflightGuessRef.current)
    setDraftGuess('')
    if (hits === guess.length && guess.length === digitsRef.current) {
      iSolvedRef.current = true
      setISolved(true)
      try {
        send({ type: 'solved', turns: confirmedTurns(merged) })
      } catch {
        /* 离线 */
      }
      if (!finishIfSettled()) {
        setStatus('你猜中了 · 对方轮次一旦追不上，你就提前赢')
      }
    } else if (peerSolvedRef.current && !finishIfSettled()) {
      const peerT = peerTurnsRef.current ?? peerGuessesRef.current.length
      const mine = confirmedTurns(merged)
      const left = Math.max(0, peerT - mine)
      setStatus(
        left > 0
          ? `对方用 ${peerT} 轮猜中 · 你还剩 ${left} 次机会`
          : `对方用 ${peerT} 轮猜中 · 你已无机会`,
      )
    }
    persistRoom()
    if (!inflightGuessRef.current) flushPendingGuesses()
  }

  /** 用内存库题面把「待同步」补成对几位 */
  function resolvePendingWithPeerSecret() {
    if (!hasStashedPeerSecret(roomCodeRef.current)) return
    let changed = false
    let solvedNow = false
    const next = myGuessesRef.current.map((g) => {
      if (!g.pending) return g
      const hits = scoreAgainstPeerSecret(roomCodeRef.current, g.guess)
      if (hits == null) return g
      changed = true
      if (hits === g.guess.length && g.guess.length === digitsRef.current) {
        solvedNow = true
      }
      return { guess: g.guess, hits, at: g.at }
    })
    if (!changed) return
    myGuessesRef.current = next
    setMyGuesses(next)
    if (solvedNow && !iSolvedRef.current) {
      iSolvedRef.current = true
      setISolved(true)
      try {
        send({ type: 'solved', turns: confirmedTurns(next) })
      } catch {
        /* 离线 */
      }
    }
    finishIfSettled()
    persistRoom()
  }

  /** 终局把内存题面提到展示 state（此时本来就要公布） */
  function revealPeerSecretForDisplay(secret?: string | null) {
    const shown =
      secret ||
      peerSecret ||
      peekStashedPeerSecret(roomCodeRef.current)
    if (shown) setPeerSecret(shown)
  }

  /** 在途超时：有对方题面则本地算出对几位；否则记 pending */
  function failInflightToPending(reason: string) {
    const cur = inflightGuessRef.current
    if (!cur) {
      setGuessBusyState(false)
      return
    }
    clearInflightGuess()
    const hits = localHitsFor(cur.guess)
    if (hits != null) {
      commitMyGuessResult(cur.guess, hits)
      setStatus('对方暂时离开，已按本地题面算出对几位')
      return
    }
    const already = myGuessesRef.current.some((g) => g.guess === cur.guess)
    if (!already) {
      const next: GuessResult = {
        guess: cur.guess,
        hits: 0,
        at: Date.now(),
        pending: true,
      }
      const merged = [...myGuessesRef.current, next]
      myGuessesRef.current = merged
      setMyGuesses(merged)
      persistRoom()
    }
    setGuessBusyState(false)
    setDraftGuess('')
    setStatus(reason)
  }

  function armInflightGuess(guess: string, requestId: string) {
    clearInflightGuess()
    const timer = window.setTimeout(() => {
      if (inflightGuessRef.current?.requestId !== requestId) return
      failInflightToPending(
        '对方迟迟没回这步；有题面已本地算出，否则先记下等连上',
      )
    }, 8000)
    inflightGuessRef.current = { guess, requestId, timer }
    setGuessBusyState(true)
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
    flushPendingGuesses()
  }

  /** 离线时记下的猜测，连上后补发给对方算命中（逐条在途，避免整表 pending 锁死按钮） */
  function flushPendingGuesses() {
    if (spectatingRef.current) return
    if (!isConnOpen()) return
    if (inflightGuessRef.current) return
    const next = myGuessesRef.current.find((g) => g.pending)
    if (!next) return
    const requestId = `${Date.now()}-${next.guess}-${Math.random().toString(36).slice(2, 6)}`
    armInflightGuess(next.guess, requestId)
    send({
      type: 'guess',
      guess: next.guess,
      requestId,
    })
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
      // 互发题面：对方断线后仍能本地判「对几位」
      sendReliable({
        type: 'secret-share',
        who: whoRef.current,
        secret: secretRef.current,
        digits: digitsRef.current,
      })
    }
    const confirmed = myGuessesRef.current.filter((g) => !g.pending)
    if (confirmed.length > 0) {
      sendReliable({ type: 'progress', guesses: confirmed })
    }
    if (iSolvedRef.current) {
      sendReliable({ type: 'solved', turns: confirmedTurns(myGuessesRef.current) })
    }
    if (endReasonRef.current === 'resign' && resignedByRef.current) {
      sendReliable({ type: 'resign', who: resignedByRef.current })
    }
    if (currentMatch() || endReasonRef.current) publishReveal()
  }

  function resetMatch(status?: string) {
    secretRef.current = ''
    secretLockedRef.current = false
    peerReadyRef.current = false
    myGuessesRef.current = []
    peerGuessesRef.current = []
    clearStashedPeerSecret(roomCodeRef.current)
    iSolvedRef.current = false
    peerSolvedRef.current = false
    peerTurnsRef.current = null
    endReasonRef.current = null
    resignedByRef.current = null
    restartAskRef.current = null
    setSecret('')
    setSecretLocked(false)
    setPeerReady(false)
    setDraftGuess('')
    setMyGuesses([])
    setPeerGuesses([])
    setPeerSecret(null)
    setISolved(false)
    setPeerSolved(false)
    setPeerTurns(null)
    setEndReason(null)
    setResignedBy(null)
    setRestartAsk(null)
    clearInflightGuess()
    setGuessBusyState(false)
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

  function applyResign(by: NoteAbout) {
    if (endReasonRef.current) return false
    endReasonRef.current = 'resign'
    resignedByRef.current = by
    setEndReason('resign')
    setResignedBy(by)
    setRestartAsk(null)
    restartAskRef.current = null
    clearInflightGuess()
    setGuessBusyState(false)
    const iResigned = by === whoRef.current
    setStatus(iResigned ? '你认输了' : '对方认输了')
    setPhase('done')
    revealPeerSecretForDisplay()
    publishReveal()
    persistRoom()
    return true
  }

  function resign() {
    if (spectatingRef.current) return
    if (phase !== 'play') return
    if (endReasonRef.current) return
    if (!isConnOpen()) {
      setError('连接断了，没法认输同步；可等连上后再认，或先回大厅')
      return
    }
    if (!applyResign(whoRef.current)) return
    sendReliable({ type: 'resign', who: whoRef.current })
  }

  /** 申请重开 / 再来一局：需对方同意 */
  function askRestart() {
    if (spectatingRef.current) return
    if (restartAskRef.current) return
    if (phase !== 'play' && phase !== 'done') return
    if (!isConnOpen()) {
      setError('连接断了，没法申请重开')
      return
    }
    const seq = againSeqRef.current + 1
    againSeqRef.current = seq
    restartAskRef.current = 'waiting'
    setRestartAsk('waiting')
    setError('')
    setStatus('已申请重开，等对方同意…')
    sendReliable({ type: 'restart-ask', seq })
  }

  function acceptRestart() {
    if (restartAskRef.current !== 'decide') return
    const seq = againSeqRef.current
    sendReliable({ type: 'restart-ok', seq })
    setGodSecrets({})
    resetMatch('双方同意重开，先各自写一个数字')
  }

  function rejectRestart() {
    if (restartAskRef.current !== 'decide') return
    sendReliable({ type: 'restart-no', seq: againSeqRef.current })
    restartAskRef.current = null
    setRestartAsk(null)
    setStatus(statusFromState())
    setError('')
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
      if (spectatingRef.current) {
        setGodSecrets((prev) => ({ ...prev, [raw.who]: raw.secret }))
        markPeerReady('secret-share')
        return
      }
      if (raw.who === whoRef.current) return
      // 只进内存库，不进 React / 存档；终局前界面看不到
      stashPeerSecret(roomCodeRef.current, raw.secret)
      markPeerReady('secret-share')
      resolvePendingWithPeerSecret()
      persistRoom()
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
      // 对方已猜中后迟到的猜不进列表，避免结算 12 轮却多出一行
      const digitsNow = digitsRef.current
      const peerAlreadySolved =
        peerSolvedRef.current ||
        peerGuessesRef.current.some(
          (g) =>
            !g.pending &&
            g.hits === digitsNow &&
            g.guess.length === digitsNow,
        )
      if (!peerAlreadySolved) {
        const peerEntry: GuessResult = {
          guess: raw.guess,
          hits,
          at: Date.now(),
        }
        if (!peerGuessesRef.current.some((g) => g.guess === raw.guess && !g.pending)) {
          const peerMerged = guessesThroughSolve(
            [...peerGuessesRef.current, peerEntry],
            digitsNow,
          )
          peerGuessesRef.current = peerMerged
          setPeerGuesses(peerMerged)
        }
      }
      if (hits === raw.guess.length && raw.guess.length === digitsNow) {
        peerSolvedRef.current = true
        setPeerSolved(true)
        const trimmed = guessesThroughSolve(peerGuessesRef.current, digitsNow)
        peerGuessesRef.current = trimmed
        setPeerGuesses(trimmed)
        peerTurnsRef.current = confirmedTurns(trimmed)
        setPeerTurns(peerTurnsRef.current)
        finishIfSettled()
      }
      persistRoom()
      return
    }

    if (raw.type === 'guess-result') {
      const inflight = inflightGuessRef.current
      const matchedInflight =
        !!inflight &&
        (inflight.requestId === raw.requestId || inflight.guess === raw.guess)
      if (matchedInflight) clearInflightGuess()

      if (raw.hits < 0) {
        setGuessBusyState(false)
        if (secretLockedRef.current) {
          resetMatch('位数已经变了，请重新出题')
        }
        return
      }
      markPeerReady('guess-result')
      commitMyGuessResult(raw.guess, raw.hits)
      return
    }

    if (raw.type === 'progress') {
      if (spectatingRef.current) return
      if (!secretLockedRef.current) return
      markPeerReady('progress')
      const trimmed = guessesThroughSolve(raw.guesses, digitsRef.current)
      peerGuessesRef.current = trimmed
      setPeerGuesses(trimmed)
      if (
        trimmed.some(
          (g) =>
            !g.pending &&
            g.hits === digitsRef.current &&
            g.guess.length === digitsRef.current,
        )
      ) {
        peerSolvedRef.current = true
        setPeerSolved(true)
        const turns = confirmedTurns(trimmed)
        if (peerTurnsRef.current == null) {
          peerTurnsRef.current = turns
          setPeerTurns(turns)
        }
      }
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
      {
        const through = guessesThroughSolve(
          peerGuessesRef.current,
          digitsRef.current,
        )
        if (through.length !== peerGuessesRef.current.length) {
          peerGuessesRef.current = through
          setPeerGuesses(through)
        }
      }
      if (!finishIfSettled()) {
        if (iSolvedRef.current) {
          setStatus('两边都猜中了，正在比轮次…')
        } else {
          const peerT =
            peerTurnsRef.current ?? peerGuessesRef.current.length
          const mine = confirmedTurns(myGuessesRef.current)
          const left = Math.max(0, peerT - mine)
          setStatus(
            left > 0
              ? `对方用 ${peerT} 轮猜中 · 你还剩 ${left} 次机会`
              : `对方用 ${peerT} 轮猜中 · 你已无机会`,
          )
        }
        persistRoom()
      }
      return
    }

    if (raw.type === 'reveal') {
      if (raw.digits !== digitsRef.current) return
      if (spectatingRef.current) {
        setGodSecrets((prev) => ({ ...prev, [raw.who]: raw.secret }))
        return
      }
      if (raw.who === whoRef.current) return
      stashPeerSecret(roomCodeRef.current, raw.secret)
      revealPeerSecretForDisplay(raw.secret)
      persistRoom()
      return
    }

    if (raw.type === 'resign') {
      if (spectatingRef.current) {
        setStatus(`${aboutLabel(raw.who)} 认输了`)
        setPhase('done')
        return
      }
      applyResign(raw.who)
      return
    }

    if (raw.type === 'restart-ask') {
      if (!Number.isInteger(raw.seq) || raw.seq <= againSeqRef.current) return
      againSeqRef.current = raw.seq
      if (spectatingRef.current) {
        setStatus('有人申请重开')
        return
      }
      // 双方几乎同时点申请：后到的当成同意
      if (restartAskRef.current === 'waiting') {
        sendReliable({ type: 'restart-ok', seq: raw.seq })
        setGodSecrets({})
        resetMatch('双方同意重开，先各自写一个数字')
        return
      }
      restartAskRef.current = 'decide'
      setRestartAsk('decide')
      setStatus('对方申请重开，是否同意？')
      return
    }

    if (raw.type === 'restart-ok') {
      if (!Number.isInteger(raw.seq) || raw.seq !== againSeqRef.current) return
      if (spectatingRef.current) {
        setGodSecrets({})
        setStatus('他们重开了')
        return
      }
      if (restartAskRef.current !== 'waiting') return
      setGodSecrets({})
      resetMatch('双方同意重开，先各自写一个数字')
      return
    }

    if (raw.type === 'restart-no') {
      if (!Number.isInteger(raw.seq) || raw.seq !== againSeqRef.current) return
      if (restartAskRef.current !== 'waiting') return
      restartAskRef.current = null
      setRestartAsk(null)
      setError('对方不同意重开')
      setStatus(statusFromState())
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
        if (inflightGuessRef.current) {
          failInflightToPending('对方暂时离开，这步已先记下；连上后自动算出对几位')
        } else {
          setGuessBusyState(false)
        }
        setError('对方暂时离开，你仍可猜；连上后自动算出对几位')
        setStatus('对方暂时离开，你仍可猜；连上后自动算出对几位')
      },
      onPeerLost: () => reenter(),
      onClose: () => {
        linkedRef.current = false
        setLinked(false)
        if (inflightGuessRef.current) {
          failInflightToPending('对方断开了，这步已先记下；连上后再同步')
        } else {
          setGuessBusyState(false)
        }
        setError('对方断开了，你仍可先猜着，连上后再同步')
        setStatus('对方断开了，你仍可先猜着，连上后再同步')
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
    if (guessBusyRef.current && isConnOpen()) return
    const guess = (rawGuess ?? draftGuess).replace(/\D/g, '').slice(0, digits)
    if (!isValidNumber(guess, digits)) {
      setError(`猜测也要 ${digits} 位数字`)
      return
    }
    if (myGuessesRef.current.some((g) => g.guess === guess)) {
      setError('这组已经猜过了')
      return
    }
    if (!sessionRef.current && room.session) {
      sessionRef.current = room.session
    }
    setError('')
    setDraftGuess(guess)

    // 对方离线：有题面则本地算出对几位；否则才记待同步
    if (!isConnOpen()) {
      clearInflightGuess()
      const hits = localHitsFor(guess)
      if (hits != null) {
        commitMyGuessResult(guess, hits)
        setStatus('对方暂时离开 · 已本地算出对几位，可继续猜')
        return
      }
      const next: GuessResult = {
        guess,
        hits: 0,
        at: Date.now(),
        pending: true,
      }
      const merged = [...myGuessesRef.current, next]
      myGuessesRef.current = merged
      setMyGuesses(merged)
      setGuessBusyState(false)
      setDraftGuess('')
      setStatus('还没有对方题面，这步先记下；连上后会算出对几位')
      persistRoom()
      return
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    armInflightGuess(guess, requestId)
    send({
      type: 'guess',
      guess,
      requestId,
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

          {inMatch ? (
            <div className="guess-meta-row">
              <p className="guess-meta">{metaLine}</p>
              {!spectating && phase === 'play' && !restartAsk ? (
                <div className="guess-meta-tools">
                  <button
                    type="button"
                    className="guess-meta-link"
                    onClick={askRestart}
                  >
                    重开
                  </button>
                  <button
                    type="button"
                    className="guess-meta-link is-danger"
                    onClick={resign}
                  >
                    认输
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

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
              ) : phase === 'done' ? (
                <div className="guess-reveal" aria-label="公布答案">
                  <div className="guess-reveal-item">
                    <span>你出的</span>
                    <strong className="font-display">{secret || '—'}</strong>
                  </div>
                  <div className="guess-reveal-item">
                    <span>对方出的</span>
                    <strong className="font-display">
                      {peerSecret || '…'}
                    </strong>
                  </div>
                </div>
              ) : (
                <MySecret digits={digits} secret={secret} compact />
              )}

              {phase === 'done' ? (
                <>
                  <GuessOutcome
                    myTurns={confirmedTurns(myGuesses)}
                    peerTurns={peerTurns ?? peerGuesses.length}
                    iSolved={iSolved}
                    peerSolved={peerSolved}
                    endReason={endReason}
                    resignedBy={resignedBy}
                    who={who}
                  />
                  {!spectating && restartAsk === 'decide' ? (
                    <div className="guess-consent" role="status">
                      <p>对方申请再来一局</p>
                      <div className="guess-consent-actions">
                        <button
                          type="button"
                          className="game-btn game-btn-leaf flex-1"
                          onClick={acceptRestart}
                        >
                          同意
                        </button>
                        <button
                          type="button"
                          className="game-btn game-btn-ghost flex-1"
                          onClick={rejectRestart}
                        >
                          拒绝
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {!spectating && restartAsk === 'waiting' ? (
                    <p className="text-center text-sm text-[var(--ink-soft)]">
                      已申请再来，等对方同意…
                    </p>
                  ) : null}
                  <div>
                    {spectating ? (
                      <p className="text-center text-sm text-[var(--ink-soft)]">
                        旁观中，等他们再来一局
                      </p>
                    ) : restartAsk ? null : (
                      <button
                        type="button"
                        className="game-btn game-btn-leaf w-full"
                        onClick={askRestart}
                      >
                        申请再来一局
                      </button>
                    )}
                  </div>
                </>
              ) : null}

              {!spectating && phase === 'play' && !iSolved ? (
                <GuessWorkbench
                  key={`wb-${digits}-${againSeqRef.current}`}
                  digits={digits}
                  guessCount={myGuesses.length}
                  hints={myGuesses
                    .filter((g) => !g.pending && g.hits >= 0)
                    .map((g) => ({ guess: g.guess, hits: g.hits }))}
                  cheatEnabled
                  onSubmit={submitGuess}
                  busy={guessBusy}
                />
              ) : null}

              {/* 对方申请重开时才打断中间；平时入口在顶部状态行 */}
              {!spectating && phase === 'play' && restartAsk === 'decide' ? (
                <div className="guess-consent" role="status">
                  <p>对方申请重开本局</p>
                  <div className="guess-consent-actions">
                    <button
                      type="button"
                      className="game-btn game-btn-leaf flex-1"
                      onClick={acceptRestart}
                    >
                      同意
                    </button>
                    <button
                      type="button"
                      className="game-btn game-btn-ghost flex-1"
                      onClick={rejectRestart}
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              ) : null}
              {!spectating && phase === 'play' && restartAsk === 'waiting' ? (
                <p className="text-center text-xs text-[var(--ink-soft)]">
                  已申请重开，等对方同意…
                </p>
              ) : null}

              {spectating ? (
                <p className="text-center text-xs text-[var(--ink-soft)]">
                  旁观只展示双方数字
                </p>
              ) : (
                <GuessHistoryPanels
                  myGuesses={guessesThroughSolve(myGuesses, digits)}
                  peerGuesses={guessesThroughSolve(peerGuesses, digits)}
                />
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
  endReason,
  resignedBy,
  who,
}: {
  myTurns: number
  peerTurns: number
  iSolved: boolean
  peerSolved: boolean
  endReason: EndReason | null
  resignedBy: NoteAbout | null
  who: NoteAbout
}) {
  if (endReason === 'resign' && resignedBy) {
    const iResigned = resignedBy === who
    const result = iResigned ? 'lose' : 'win'
    return (
      <div
        className={[
          'guess-outcome',
          result === 'win' ? 'is-win' : 'is-lose',
        ].join(' ')}
      >
        <p className="guess-outcome-title font-display">
          {iResigned ? '你认输了' : '对方认输'}
        </p>
        <p className="guess-outcome-cheer">
          {iResigned ? '这局先到这里，申请再来一盘吧' : '对方中盘认输，这局归你'}
        </p>
        <p className="guess-outcome-meta">
          你 {myTurns} 轮 · 对方 {peerTurns} 轮
        </p>
        {result === 'win' ? (
          <span className="guess-outcome-burst" aria-hidden />
        ) : null}
      </div>
    )
  }

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

/** 每位最多三轮排除；用 tag 切换当前轮，可一键清空该轮及以后 */
const EXCLUDE_PASS_COUNT = 3
type ExcludePass = 0 | 1 | 2
type ExcludeLayers = [string[], string[], string[]]

const EXCLUDE_TAGS: ReadonlyArray<{ id: ExcludePass; label: string }> = [
  { id: 0, label: '一轮' },
  { id: 1, label: '二轮' },
  { id: 2, label: '三轮' },
]

function emptyExcludeLayers(n: number): ExcludeLayers[] {
  return Array.from({ length: n }, () => [[], [], []])
}

function cloneLayers(rows: ExcludeLayers[]): ExcludeLayers[] {
  return rows.map(
    (row) => [[...row[0]], [...row[1]], [...row[2]]] as ExcludeLayers,
  )
}

function layerUnion(row: ExcludeLayers): Set<string> {
  return new Set([...row[0], ...row[1], ...row[2]])
}

function digitPass(row: ExcludeLayers, digit: string): ExcludePass | null {
  for (let p = EXCLUDE_PASS_COUNT - 1; p >= 0; p--) {
    if (row[p as ExcludePass].includes(digit)) return p as ExcludePass
  }
  return null
}

function highestPassUsed(row: ExcludeLayers): ExcludePass | null {
  for (let p = EXCLUDE_PASS_COUNT - 1; p >= 0; p--) {
    if (row[p as ExcludePass].length > 0) return p as ExcludePass
  }
  return null
}

function slotsToGuess(slots: Array<string | null>): string {
  return slots.every((d) => d != null) ? slots.join('') : ''
}

/** 填入为主；排除用 tag 切轮；已知用锁定按钮。不同步给对方 */
function GuessWorkbench({
  digits,
  guessCount,
  hints,
  cheatEnabled = false,
  onSubmit,
  busy,
}: {
  digits: DigitLen
  guessCount: number
  /** 已确认 hits，供右下角叶子三连点支招 */
  hints?: GuessHint[]
  cheatEnabled?: boolean
  onSubmit: (guess: string) => void
  busy: boolean
}) {
  const [known, setKnown] = useState<Array<string | null>>(() => emptySlots(digits))
  const [guessSlots, setGuessSlots] = useState<Array<string | null>>(() =>
    emptySlots(digits),
  )
  const [excludeLayers, setExcludeLayers] = useState<ExcludeLayers[]>(() =>
    emptyExcludeLayers(digits),
  )
  const [excludePass, setExcludePass] = useState<ExcludePass>(0)
  const [focus, setFocus] = useState(0)
  const [cheatTip, setCheatTip] = useState<string | null>(null)
  const prevGuessCount = useRef(guessCount)
  const cheatClicksRef = useRef({ n: 0, at: 0 })
  const cheatTipTimer = useRef(0)
  const knownRef = useRef(known)
  knownRef.current = known
  const hintsRef = useRef(hints ?? [])
  hintsRef.current = hints ?? []

  useEffect(() => {
    if (guessCount === prevGuessCount.current) return
    prevGuessCount.current = guessCount
    setGuessSlots(Array.from({ length: digits }, (_, i) => known[i] ?? null))
    const next = known.findIndex((d) => !d)
    setFocus(next >= 0 ? next : 0)
  }, [guessCount, digits, known])

  useEffect(
    () => () => {
      window.clearTimeout(cheatTipTimer.current)
    },
    [],
  )

  function applyCheatSuggest() {
    if (busy) return
    const picked = suggestNextGuess({
      digits,
      history: hintsRef.current,
      knownMask: knownRef.current,
    })
    if (!picked) {
      setCheatTip('暂无可用建议')
      window.clearTimeout(cheatTipTimer.current)
      cheatTipTimer.current = window.setTimeout(() => setCheatTip(null), 1600)
      return
    }
    const chars = [...picked.guess]
    setGuessSlots(
      Array.from({ length: digits }, (_, i) => knownRef.current[i] ?? chars[i] ?? null),
    )
    const next = knownRef.current.findIndex((d) => !d)
    setFocus(next >= 0 ? next : 0)
    setCheatTip(
      picked.remaining <= 1
        ? `支招 ${picked.guess}`
        : `支招 ${picked.guess} · 余 ${picked.remaining}`,
    )
    window.clearTimeout(cheatTipTimer.current)
    cheatTipTimer.current = window.setTimeout(() => setCheatTip(null), 2200)
  }

  function onCheatLeafClick() {
    const now = Date.now()
    const cur = cheatClicksRef.current
    if (now - cur.at > 1000) {
      cur.n = 0
    }
    cur.n += 1
    cur.at = now
    if (cur.n < 3) return
    cur.n = 0
    applyCheatSuggest()
  }

  const displaySlots = Array.from(
    { length: digits },
    (_, i) => known[i] ?? guessSlots[i] ?? null,
  )
  const focusLayers =
    excludeLayers[focus] ?? ([[], [], []] as ExcludeLayers)
  const locked = !!known[focus]
  const focusDigit = displaySlots[focus]
  const passHasAny = (pass: ExcludePass) =>
    excludeLayers.some((row) => row[pass].length > 0)

  function advanceFocus(from: number) {
    for (let step = 1; step <= digits; step++) {
      const i = (from + step) % digits
      if (known[i]) continue
      setFocus(i)
      return
    }
    setFocus(from)
  }

  /** 清空本轮填入；已锁定的已知位保留 */
  function clearFilledGuess() {
    setGuessSlots(Array.from({ length: digits }, (_, i) => known[i] ?? null))
  }

  function unlockFocused() {
    if (!known[focus]) return
    setKnown((prev) => {
      const next = [...prev]
      next[focus] = null
      return next
    })
  }

  function lockFocused() {
    if (locked) {
      unlockFocused()
      return
    }
    if (!focusDigit) return
    setKnown((prev) => {
      const next = [...prev]
      next[focus] = focusDigit
      return next
    })
    setGuessSlots((prev) => {
      const next = [...prev]
      next[focus] = focusDigit
      return next
    })
    advanceFocus(focus)
  }

  function fillDigit(digit: string) {
    if (locked) {
      advanceFocus(focus)
      return
    }
    // 排除位仍可填入（用来推演其他位）；格子标红，排除记录不动
    const excluded = layerUnion(focusLayers).has(digit)
    setGuessSlots((prev) => {
      const next = [...prev]
      next[focus] = digit
      return next
    })
    // 填入排除数字时留在本格，避免焦点跳走后误以为排除被清掉
    if (!excluded) advanceFocus(focus)
  }

  function excludeDigit(digit: string) {
    if (locked) return
    const alreadyExcluded = layerUnion(focusLayers).has(digit)
    if (alreadyExcluded) {
      // 已排除：默认填入猜测并保留排除（标红）
      // 仅当本格已经填着该排除数字时，再点才取消排除
      if (displaySlots[focus] === digit) {
        setExcludeLayers((prev) => {
          const next = cloneLayers(prev)
          const row = next[focus]
          for (let p = 0; p < EXCLUDE_PASS_COUNT; p++) {
            row[p as ExcludePass] = row[p as ExcludePass].filter((d) => d !== digit)
          }
          return next
        })
        return
      }
      fillDigit(digit)
      return
    }
    setExcludeLayers((prev) => {
      const next = cloneLayers(prev)
      const row = next[focus]
      for (let p = 0; p < EXCLUDE_PASS_COUNT; p++) {
        row[p as ExcludePass] = row[p as ExcludePass].filter((d) => d !== digit)
      }
      row[excludePass] = [...row[excludePass], digit]
      return next
    })
  }

  /** 清空从该轮起的排除（含本轮），保留更早轮次 */
  function clearPassFrom(pass: ExcludePass) {
    setExcludeLayers((prev) =>
      prev.map((row) => {
        const next = [[...row[0]], [...row[1]], [...row[2]]] as ExcludeLayers
        for (let p = pass; p < EXCLUDE_PASS_COUNT; p++) {
          next[p as ExcludePass] = []
        }
        return next
      }),
    )
    if (excludePass >= pass) setExcludePass(pass > 0 ? ((pass - 1) as ExcludePass) : 0)
  }

  const submitValue = slotsToGuess(displaySlots)
  const canSubmit = isValidNumber(submitValue, digits) && !busy

  return (
    <div className="guess-workbench">
      <div className="guess-guess-row">
        <div className="guess-slots" style={{ '--guess-n': digits } as CSSProperties}>
          {displaySlots.map((d, i) => {
            const isLocked = !!known[i]
            const row = excludeLayers[i] ?? ([[], [], []] as ExcludeLayers)
            const top = highestPassUsed(row)
            const excludedFill = !!(d && layerUnion(row).has(d))
            return (
              <button
                key={`g-${i}`}
                type="button"
                className={[
                  'guess-slot',
                  isLocked ? 'is-locked' : '',
                  focus === i ? 'is-focus' : '',
                  d ? 'is-filled' : '',
                  excludedFill ? 'is-excluded-fill' : '',
                  top != null ? 'has-out' : '',
                  top != null ? `has-out-${top + 1}` : '',
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

      <div className="guess-toolbar">
        <button type="button" className="guess-workbench-link" onClick={clearFilledGuess}>
          清空填入
        </button>
        <button
          type="button"
          className="guess-workbench-link"
          disabled={!locked && !focusDigit}
          onClick={lockFocused}
        >
          {locked ? '解锁已知' : '锁为已知'}
        </button>
        <span className="guess-toolbar-tip">
          {cheatTip ?? `第 ${focus + 1} 格 · 下方数字填入`}
        </span>
      </div>

      <div className="guess-pad">
        {Array.from({ length: 10 }, (_, n) => String(n)).map((d) => {
          const pass = digitPass(focusLayers, d)
          const isOut = pass != null
          return (
            <button
              key={d}
              type="button"
              className={[
                isOut ? 'is-out' : '',
                pass != null ? `is-out-${pass + 1}` : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={locked}
              onClick={() => fillDigit(d)}
            >
              {d}
            </button>
          )
        })}
      </div>

      <div className="guess-exclude-panel">
        <div className="guess-exclude-head">
          <span>本格排除</span>
          <div className="guess-exclude-tags" role="tablist" aria-label="排除轮次">
            {EXCLUDE_TAGS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={excludePass === p.id}
                className={[
                  `is-pass-${p.id + 1}`,
                  excludePass === p.id ? 'is-on' : '',
                  passHasAny(p.id) ? 'has-data' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setExcludePass(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="guess-exclude-pad" data-pass={excludePass + 1}>
          {Array.from({ length: 10 }, (_, n) => String(n)).map((d) => {
            const pass = digitPass(focusLayers, d)
            const inCurrent = focusLayers[excludePass].includes(d)
            return (
              <button
                key={d}
                type="button"
                className={[
                  pass != null ? 'is-out' : '',
                  pass != null ? `is-out-${pass + 1}` : '',
                  inCurrent ? 'is-current' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={locked}
                onClick={() => excludeDigit(d)}
              >
                {d}
              </button>
            )
          })}
        </div>

        <div className="guess-exclude-clears">
          {EXCLUDE_TAGS.filter((p) => p.id > 0).map((p) => (
            <button
              key={p.id}
              type="button"
              className="guess-workbench-link"
              disabled={!EXCLUDE_TAGS.some((x) => x.id >= p.id && passHasAny(x.id))}
              onClick={() => clearPassFrom(p.id)}
            >
              清空{p.label}
            </button>
          ))}
        </div>
      </div>

      {cheatEnabled ? (
        <button
          type="button"
          className="guess-cheat-leaf"
          aria-label="支招"
          tabIndex={-1}
          onClick={onCheatLeafClick}
        >
          <svg viewBox="0 0 80 110" fill="none" aria-hidden>
            <path d="M40 100C34 68 22 36 40 8C58 36 48 70 40 100Z" fill="#3f7a61" />
            <path
              d="M40 96C36 64 28 36 40 14"
              stroke="#1f4634"
              strokeWidth="0.9"
              strokeOpacity="0.4"
            />
            <path
              d="M40 70C28 58 18 40 22 24"
              stroke="#24543f"
              strokeWidth="0.7"
              strokeOpacity="0.28"
            />
          </svg>
        </button>
      ) : null}
    </div>
  )
}

function GuessHistoryPanels({
  myGuesses,
  peerGuesses,
}: {
  myGuesses: GuessResult[]
  peerGuesses: GuessResult[]
}) {
  return (
    <div className="guess-history is-split">
      <GuessList title="你" guesses={myGuesses} scrollable />
      <GuessList title="对方" guesses={peerGuesses} scrollable />
    </div>
  )
}

function GuessList({
  title,
  guesses,
  scrollable = false,
}: {
  title: string
  guesses: GuessResult[]
  /** 历史列表在各自栏内独立滚动 */
  scrollable?: boolean
}) {
  return (
    <div className={`guess-list${scrollable ? ' is-scroll' : ''}`}>
      <h2>{title}</h2>
      <ul>
        {guesses.length === 0 ? (
          <li className="is-empty">还没有</li>
        ) : (
          [...guesses].reverse().map((g) => (
            <li key={`${g.guess}-${g.at}`} className={g.pending ? 'is-pending' : ''}>
              <span className="guess-list-digits font-display" aria-label={g.guess}>
                {[...g.guess].map((d, i) => (
                  <span key={`${g.at}-${i}`} className="guess-list-digit">
                    {d}
                  </span>
                ))}
              </span>
              <span className="guess-list-hits">{formatGuessHits(g)}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
