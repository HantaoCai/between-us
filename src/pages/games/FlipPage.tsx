import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnterRoomGate } from '../../components/EnterRoomGate'
import { GameShell, RuleTip } from '../../components/GameShell'
import { RoomBanner } from '../../components/PeerLobby'
import { createBotDriverForGame } from '../../lib/botDrivers'
import { isSoloPlay, isSoloRoomCode } from '../../lib/botRoomSession'
import { mountSoloBotSession } from '../../lib/bootSoloSession'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import { leaveGameToHub } from '../../lib/hubNav'
import { wrapGameHandlers } from '../../lib/gameSession'
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
  clearPeerRoom,
  peerRoomMeta,
  savePlayPeerRoom,
  useFlushPeerRoomOnLeave,
} from '../../lib/peerRoomSave'
import { useGamePeerBoot } from '../../lib/useGamePeerBoot'
import {
  buildFlipIcons,
  emptyFlipScores,
  ENDGAME_PAIRS,
  FLIP_COUNT,
  FLIP_SPECIAL_HELP,
  flipEffectSeed,
  flipWinner,
  isEndgame,
  isSpecialIcon,
  nextTurnAfterClose,
  pickPeekIndices,
  pointsForMatch,
  remainingPairs,
  shuffleUnmatchedIcons,
  SPECIAL_BOMB,
  SPECIAL_PEEK,
  SPECIAL_SHUFFLE,
  specialDesc,
  specialLabel,
  type FlipScores,
} from '../../lib/flipGame'

const RULE =
  '6×6 棋盘。配对得分并继续翻，配错换人；连击额外加分。剩 3 对起残局双倍分。清完比分高者胜。牌面有偷窥、洗牌、炸弹。'
const PEEK_MS = 1400

function FlipRulesTip() {
  return (
    <div className="game-tip-body">
      <p className="game-tip-lead">怎么玩</p>
      <ul className="game-tip-list">
        <li>轮流翻两张；配对得分并继续翻，配错则换人。</li>
        <li>连击：同一回合连续配对，第 2 次起额外加分。</li>
        <li>残局：场上还剩 {ENDGAME_PAIRS} 对及以内，配对得分 ×2。</li>
        <li>清完后比分高者胜；平手则平局。</li>
      </ul>
      <p className="game-tip-lead">特殊牌（配对触发）</p>
      <ul className="game-tip-specials">
        {FLIP_SPECIAL_HELP.map((item) => (
          <li key={item.icon}>
            <span className="game-tip-special-icon" aria-hidden>
              {item.icon}
            </span>
            <span>
              <strong>{item.name}</strong>
              {item.desc}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

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
  scores: FlipScores
  skip: NoteAbout | null
  streak: number
  peek: number[]
}

type Msg =
  | { type: 'hello'; who: NoteAbout }
  | { type: 'need-start' }
  | SyncMsg
  | { type: 'flip'; seq: number; index: number; by: NoteAbout }
  | { type: 'close'; seq: number }
  | { type: 'peek-end'; seq: number }

function isAbout(value: unknown): value is NoteAbout {
  return value === 'her' || value === 'me'
}

function isScores(value: unknown): value is FlipScores {
  if (!value || typeof value !== 'object') return false
  const s = value as FlipScores
  return (
    Number.isInteger(s.her) &&
    s.her >= 0 &&
    s.her <= 200 &&
    Number.isInteger(s.me) &&
    s.me >= 0 &&
    s.me <= 200
  )
}

function isSync(raw: Msg): raw is SyncMsg {
  if (raw.type !== 'sync') return false
  const msg = raw as SyncMsg
  if (!Number.isInteger(msg.seq) || msg.seq < 1) return false
  if (!Array.isArray(msg.icons) || msg.icons.length !== FLIP_COUNT) return false
  if (
    !msg.icons.every(
      (icon) => typeof icon === 'string' && icon.length > 0 && icon.length < 12,
    )
  ) {
    return false
  }
  if (!Array.isArray(msg.matched) || msg.matched.length !== FLIP_COUNT) return false
  if (!msg.matched.every((flag) => typeof flag === 'boolean')) return false
  if (!Array.isArray(msg.open) || msg.open.length > 2) return false
  if (
    !msg.open.every(
      (index) => Number.isInteger(index) && index >= 0 && index < FLIP_COUNT,
    )
  ) {
    return false
  }
  if (!isAbout(msg.turn)) return false
  if (!Number.isInteger(msg.moves) || msg.moves < 0 || msg.moves > 300) return false
  if (!isScores(msg.scores)) return false
  if (msg.skip !== null && !isAbout(msg.skip)) return false
  if (!Number.isInteger(msg.streak) || msg.streak < 0 || msg.streak > 20) return false
  if (!Array.isArray(msg.peek) || msg.peek.length > 4) return false
  if (
    !msg.peek.every(
      (index) => Number.isInteger(index) && index >= 0 && index < FLIP_COUNT,
    )
  ) {
    return false
  }
  return typeof msg.lock === 'boolean'
}

export function FlipPage() {
  const navigate = useNavigate()
  const room = usePeerRoom()
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
  const [scores, setScores] = useState<FlipScores>(emptyFlipScores)
  const [streak, setStreak] = useState(0)
  const [peek, setPeek] = useState<number[]>([])
  const [fx, setFx] = useState('')

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
  const scoresRef = useRef<FlipScores>(emptyFlipScores())
  const streakRef = useRef(0)
  const skipRef = useRef<NoteAbout | null>(null)
  const peekRef = useRef<number[]>([])
  const seqRef = useRef(0)
  const firstRef = useRef<NoteAbout>('her')
  const closeTimer = useRef(0)
  const peekTimer = useRef(0)
  const closeArmed = useRef(false)

  whoRef.current = who
  peerWhoRef.current = peerWho
  codeRef.current = code
  isHostRef.current = isHost

  const leavingHubRef = useRef(false)

  usePeerSessionGuard(sessionRef, () => true)
  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current)
      window.clearTimeout(peekTimer.current)
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
    return peerRoomMeta({
      game: 'flip',
      code: codeRef.current,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
    })
  })

  const resumeSavedRef = useRef<{
    code: string
    role: 'host' | 'joiner'
    who: NoteAbout
  } | null>(null)

  useGamePeerBoot(
    'flip',
    () => {
      if (isSoloPlay({ code: room.code, session: room.session })) {
        bootSoloSession(room.who, room.code)
        return
      }
      adoptLiveFromProvider()
    },
    (saved) => {
      resumeSavedRef.current = { code: saved.code, role: saved.role, who: saved.who }
      setBusy(true)
      setError('')
      whoRef.current = saved.who
      setWho(saved.who)
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
    const driver = createBotDriverForGame('flip', {
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
    peerWhoRef.current = botWho
    setPeerWho(botWho)
    bindFlipSession(session, true)
    setBusy(false)
  }

  function adoptLiveFromProvider() {
    const session = room.session
    if (!session) return
    room.bindHandlers(navHandlers(flipHandlers()))
    sessionRef.current = session
    whoRef.current = room.who
    setWho(room.who)
    isHostRef.current = room.isHost
    setIsHost(room.isHost)
    codeRef.current = room.code
    setCode(room.code)
    if (room.peerWho) {
      peerWhoRef.current = room.peerWho
      setPeerWho(room.peerWho)
    }
    setPhase('table')
    setBusy(false)
    setError('')
    if (session.conn?.open) {
      setTimeout(() => onRoomOpen(), 0)
    }
  }

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
      scores: { ...scoresRef.current },
      skip: skipRef.current,
      streak: streakRef.current,
      peek: peekRef.current,
    }
  }

  function ensureCloseTimer() {
    if (!lockRef.current || turnRef.current !== whoRef.current || closeArmed.current) {
      return
    }
    if (peekRef.current.length > 0) return
    closeArmed.current = true
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      closeArmed.current = false
      const seq = seqRef.current
      sessionRef.current?.sendReliable({ type: 'close', seq })
      applyClose(seq)
    }, 700)
  }

  function armPeekEnd(seq: number) {
    window.clearTimeout(peekTimer.current)
    peekTimer.current = window.setTimeout(() => {
      if (seq !== seqRef.current) return
      if (turnRef.current === whoRef.current) {
        sessionRef.current?.sendReliable({ type: 'peek-end', seq })
      }
      applyPeekEnd(seq)
    }, PEEK_MS)
  }

  function applyPeekEnd(seq: number) {
    if (seq !== seqRef.current) return
    if (peekRef.current.length === 0) return
    window.clearTimeout(peekTimer.current)
    peekRef.current = []
    setPeek([])
    lockRef.current = false
    setLock(false)
    setFx('')
  }

  function applyClose(seq: number) {
    if (seq !== seqRef.current || !lockRef.current) return
    if (peekRef.current.length > 0) return
    window.clearTimeout(closeTimer.current)
    closeArmed.current = false
    lockRef.current = false
    setLock(false)
    openRef.current = []
    setOpen([])
    streakRef.current = 0
    setStreak(0)
    const from = turnRef.current
    const stepped = nextTurnAfterClose(from, skipRef.current)
    const bombSkip = skipRef.current !== null && stepped.turn === from
    skipRef.current = stepped.skip
    turnRef.current = stepped.turn
    setTurn(stepped.turn)
    setFx(bombSkip ? '炸弹生效，对方跳过一轮' : '')
  }

  function applySpecialMatch(icon: string, by: NoteAbout) {
    const matchedCount = deckRef.current.filter((c) => c.matched).length
    const seed = flipEffectSeed(seqRef.current, movesRef.current, matchedCount)

    if (icon === SPECIAL_PEEK) {
      const indices = pickPeekIndices(
        deckRef.current.map((c) => c.matched),
        seed,
        2,
      )
      if (indices.length > 0) {
        peekRef.current = indices
        setPeek(indices)
        lockRef.current = true
        setLock(true)
        setFx(`${aboutLabel(by)} 偷窥了 ${indices.length} 张`)
        armPeekEnd(seqRef.current)
      }
      return
    }

    if (icon === SPECIAL_SHUFFLE) {
      const icons = shuffleUnmatchedIcons(
        deckRef.current.map((c) => c.icon),
        deckRef.current.map((c) => c.matched),
        seed,
      )
      const nextDeck = deckRef.current.map((card, i) => ({
        ...card,
        icon: icons[i]!,
      }))
      deckRef.current = nextDeck
      setDeck(nextDeck)
      setFx(`${aboutLabel(by)} 洗了未配的牌`)
      return
    }

    if (icon === SPECIAL_BOMB) {
      skipRef.current = otherAbout(by)
      setFx(`${aboutLabel(by)} 丢了炸弹，对方下轮跳过`)
    }
  }

  function applyFlip(index: number, by: NoteAbout): boolean {
    if (doneRef.current || lockRef.current) return false
    if (peekRef.current.length > 0) return false
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
    if (deckNow[a!].icon === deckNow[b!].icon) {
      const icon = deckNow[a!].icon
      const nextStreak = streakRef.current + 1
      streakRef.current = nextStreak
      setStreak(nextStreak)
      const pairsLeft = remainingPairs(deckNow.map((c) => c.matched))
      const endgame = pairsLeft <= ENDGAME_PAIRS
      const gain = pointsForMatch(icon, nextStreak, pairsLeft)
      const nextScores = {
        ...scoresRef.current,
        [by]: scoresRef.current[by] + gain,
      }
      scoresRef.current = nextScores
      setScores(nextScores)

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

      const label = specialLabel(icon)
      const endTag = endgame ? ' · 残局×2' : ''
      if (label) {
        setFx(`${aboutLabel(by)} 配上${label} +${gain}${endTag}`)
      } else if (nextStreak > 1) {
        setFx(`${aboutLabel(by)} 连击 ×${nextStreak} +${gain}${endTag}`)
      } else {
        setFx(`${aboutLabel(by)} +${gain}${endTag}`)
      }

      if (!finished) {
        // 配对成功：继续翻
        applySpecialMatch(icon, by)
      }
      return true
    }

    streakRef.current = 0
    setStreak(0)
    lockRef.current = true
    setLock(true)
    setFx('')
    if (by === whoRef.current) ensureCloseTimer()
    return true
  }

  function applySync(msg: SyncMsg) {
    if (deckRef.current.length > 0 && msg.seq <= seqRef.current) return
    window.clearTimeout(closeTimer.current)
    window.clearTimeout(peekTimer.current)
    closeArmed.current = false
    seqRef.current = msg.seq
    const nextDeck = msg.icons.map((icon, index) => ({
      icon,
      matched: msg.matched[index] === true,
    }))
    deckRef.current = nextDeck
    setDeck(nextDeck)
    const nextOpen =
      msg.lock && msg.open.length === 2 ? msg.open : msg.lock ? [] : msg.open
    openRef.current = nextOpen
    setOpen(nextOpen)
    turnRef.current = msg.turn
    setTurn(msg.turn)
    movesRef.current = msg.moves
    setMoves(msg.moves)
    scoresRef.current = { ...msg.scores }
    setScores({ ...msg.scores })
    skipRef.current = msg.skip
    streakRef.current = msg.streak
    setStreak(msg.streak)
    peekRef.current = msg.peek.slice()
    setPeek(msg.peek.slice())
    const locked =
      (msg.lock && nextOpen.length === 2) || msg.peek.length > 0
    lockRef.current = locked
    setLock(locked)
    const finished = nextDeck.every((card) => card.matched)
    doneRef.current = finished
    setDone(finished)
    setFx('')
    if (msg.peek.length > 0) armPeekEnd(msg.seq)
    else if (locked && nextOpen.length === 2) ensureCloseTimer()
  }

  function deal(icons: string[], first: NoteAbout) {
    window.clearTimeout(closeTimer.current)
    window.clearTimeout(peekTimer.current)
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
    scoresRef.current = emptyFlipScores()
    setScores(emptyFlipScores())
    streakRef.current = 0
    setStreak(0)
    skipRef.current = null
    peekRef.current = []
    setPeek([])
    setFx('')
    sessionRef.current?.sendReliable(buildSync())
  }

  function ensureDeal() {
    if (!sessionRef.current?.isHost) return
    if (seqRef.current === 0) {
      deal(buildFlipIcons(), whoRef.current)
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
      return
    }
    if (msg.type === 'peek-end') {
      if (!Number.isInteger(msg.seq)) return
      applyPeekEnd(msg.seq)
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

  function flipHandlers() {
    return {
      onData,
      onOpen: onRoomOpen,
      onWake: () => {
        hello()
        if (seqRef.current > 0) sessionRef.current?.sendReliable(buildSync())
        else if (!sessionRef.current?.isHost) {
          sessionRef.current?.sendReliable({ type: 'need-start' })
        }
      },
      onDisconnect: () => setError('对方暂时离开，你仍可操作；连上后会自动同步进度'),
      onClose: () => setError('对方断开了'),
    }
  }

  function navHandlers(handlers: RoomHandlers) {
    return wrapGameHandlers(handlers, {
      hereGame: 'flip',
      navigate,
      room,
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

  function bindFlipSession(session: RoomSession, kickOpen: boolean) {
    sessionRef.current = session
    room.attachSession(session, { who: whoRef.current })
    room.bindHandlers(navHandlers(flipHandlers()))
    isHostRef.current = session.isHost
    setIsHost(session.isHost)
    codeRef.current = session.code
    setCode(session.code)
    setPhase('table')
    savePlayPeerRoom({
      game: 'flip',
      code: session.code,
      role: session.isHost ? 'host' : 'joiner',
      who: whoRef.current,
      mode: isSoloPlay({ code: session.code, session }) ? 'solo' : 'peer',
    })
    if (kickOpen && session.conn?.open) onRoomOpen()
  }

  async function create(existingCode?: string) {
    setBusy(true)
    setError('')
    try {
      const handlers = navHandlers(flipHandlers())
      if (existingCode) {
        const live = await adoptParkedSession(existingCode, true, handlers)
        if (live) {
          bindFlipSession(live, true)
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
      bindFlipSession(session, false)
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
      const handlers = navHandlers(flipHandlers())
      const live = await adoptParkedSession(room, false, handlers)
      if (live) {
        bindFlipSession(live, true)
        return
      }
      sessionRef.current?.destroy()
      sessionRef.current = null
      await releaseParkedRoom(room)
      const session = await joinPeerRoom(room, handlers)
      bindFlipSession(session, false)
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
    deal(buildFlipIcons(), first)
  }

  async function leaveRoom() {
    if (leavingHubRef.current) return
    leavingHubRef.current = true
    const roomCode = codeRef.current || room.code
    if (!roomCode) {
      clearPeerRoom('flip')
      navigate('/games', { replace: true })
      return
    }
    setBusy(true)
    await leaveGameToHub({
      sendReliable: (data, times) => room.sendReliable(data, times),
      code: roomCode,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
      navigate,
      fromGame: 'flip',
      onLocalLeave: () => {
        sessionRef.current = null
        peerWhoRef.current = null
        setPeerWho(null)
      },
    })
  }

  const peerName = peerWho ? aboutLabel(peerWho) : '对方'
  const mine = turn === who
  const winner = flipWinner(scores, done)
  const myScore = scores[who]
  const peerScore = peerWho ? scores[peerWho] : 0
  const outcome =
    winner === null
      ? ''
      : winner === 'draw'
        ? '平手'
        : winner === who
          ? '你赢了'
          : `${peerName}赢了`

  return (
    <GameShell
      title="翻翻乐"
      blurb={RULE}
      tip={<FlipRulesTip />}
      compact={phase !== 'lobby' && deck.length > 0}
      keepTip={phase !== 'lobby' && deck.length > 0}
      onBackToHub={phase === 'lobby' ? undefined : () => void leaveRoom()}
      backBusy={busy}
    >
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
        </div>
      ) : (
        <div className="space-y-3">
          <div className="game-flip-score">
            <div className={`game-flip-score-side ${mine ? '' : 'is-active'}`}>
              <span>{peerName}</span>
              <strong>{peerScore}</strong>
            </div>
            <div className="game-flip-score-mid">
              {done ? (
                <>
                  <p className="game-flip-outcome">{outcome}</p>
                  <p className="text-xs text-[var(--ink-soft)]">{moves} 步</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-[var(--ink)]">
                    {mine ? '轮到你' : `轮到${aboutLabel(turn)}`}
                    {streak > 1 ? ` · 连击 ×${streak}` : ''}
                    {isEndgame(deck.map((c) => c.matched)) ? ' · 残局×2' : ''}
                  </p>
                  <p className="text-xs text-[var(--ink-soft)]">{moves} 步</p>
                </>
              )}
            </div>
            <div className={`game-flip-score-side is-me ${mine ? 'is-active' : ''}`}>
              <span>你</span>
              <strong>{myScore}</strong>
            </div>
          </div>

          {fx ? <p className="game-flip-fx">{fx}</p> : null}

          <div className="game-flip-board">
            {deck.map((card, index) => {
              const shown =
                card.matched || open.includes(index) || peek.includes(index)
              const special = shown && isSpecialIcon(card.icon)
              return (
                <button
                  key={index}
                  type="button"
                  disabled={
                    done ||
                    lock ||
                    !mine ||
                    card.matched ||
                    open.includes(index) ||
                    peek.length > 0
                  }
                  onClick={() => flip(index)}
                  className={[
                    'game-flip-tile',
                    shown ? 'is-face' : 'is-back',
                    card.matched ? 'is-matched' : '',
                    peek.includes(index) ? 'is-peek' : '',
                    special ? 'is-special' : '',
                    !mine && !shown ? 'is-dim' : '',
                  ].join(' ')}
                  title={
                    special
                      ? `${specialLabel(card.icon)}：${specialDesc(card.icon)}`
                      : undefined
                  }
                >
                  {shown ? card.icon : '?'}
                </button>
              )
            })}
          </div>

          <div className="game-flip-legend-row">
            <p className="game-flip-legend">
              {FLIP_SPECIAL_HELP.map((item, i) => (
                <span key={item.icon}>
                  {i > 0 ? ' · ' : null}
                  {item.icon}
                  {item.name}
                </span>
              ))}
            </p>
            <RuleTip label="特殊牌说明" placement="end">
              <div className="game-tip-body">
                <p className="game-tip-lead">特殊牌道具</p>
                <ul className="game-tip-specials">
                  {FLIP_SPECIAL_HELP.map((item) => (
                    <li key={item.icon}>
                      <span className="game-tip-special-icon" aria-hidden>
                        {item.icon}
                      </span>
                      <span>
                        <strong>{item.name}</strong>
                        {item.desc}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="game-tip-note">配成一对后立刻生效；顶部问号可看完整规则。</p>
              </div>
            </RuleTip>
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
        </div>
      )}
    </GameShell>
  )
}
