import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GameShell } from '../../components/GameShell'
import { EnterRoomGate } from '../../components/EnterRoomGate'
import { RoomBanner } from '../../components/PeerLobby'
import { leaveGameToHub, withHubNav } from '../../lib/hubNav'
import {
  BIG_BLIND,
  bestHand,
  cardColor,
  compareHand,
  formatCard,
  freshDeck,
  SMALL_BLIND,
  START_STACK,
  type Card,
} from '../../lib/poker'
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
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import {
  isSavedPokerHand,
  savePeerRoom,
  useFlushPeerRoomOnLeave,
  type SavedPokerHand,
} from '../../lib/peerRoomSave'
import { useGamePeerBoot } from '../../lib/useGamePeerBoot'

type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
type Phase = 'lobby' | 'wait' | 'play'

/** 加注快捷筹码：点几下累加 */
const RAISE_CHIPS = [20, 50, 100, 200] as const
/** 金额旁微调步进 */
const RAISE_NUDGE = SMALL_BLIND

type PublicState = {
  street: Street
  board: Card[]
  pot: number
  stacks: Record<NoteAbout, number>
  toAct: NoteAbout
  betThisRound: Record<NoteAbout, number>
  /** 这手每人已投入底池的筹码（弃牌即丢掉） */
  committed: Record<NoteAbout, number>
  /** 本街谁已经行动过；双方都行动且注额对齐才进下一街 */
  actedThisStreet: Record<NoteAbout, boolean>
  /** 本街谁已经加注过；每人每街只能加一次，对方加注后仍可再加一次 */
  raisedThisStreet: Record<NoteAbout, boolean>
  /** 本街加注总次数（兼容旧存档/同步） */
  raisesThisStreet: number
  folded: NoteAbout | null
  button: NoteAbout
  result?: string
  /** 有一方筹码耗尽，整局结束 */
  matchOver?: boolean
  /** 谁已亮出底牌（比牌强制双方亮；弃牌后可自愿亮） */
  revealed: Record<NoteAbout, boolean>
  /** 谁已点「下一手」；双方都确认后由房主发牌 */
  readyNext: Record<NoteAbout, boolean>
  /** 本手跟注对方 All-in 的人；比牌赢了打出 Hero Call */
  heroCallBy?: NoteAbout | null
  /** 彩蛋（同步给双方）：Hero Call / Nice Fold */
  egg?: 'hero-call' | 'nice-fold' | null
}

type EggFlash = 'hero-call' | 'nice-fold'

function inferRevealed(state: {
  street: Street
  folded: NoteAbout | null
  revealed?: Record<NoteAbout, boolean>
}): Record<NoteAbout, boolean> {
  const cur = state.revealed
  if (
    cur &&
    typeof cur.her === 'boolean' &&
    typeof cur.me === 'boolean'
  ) {
    return { her: cur.her, me: cur.me }
  }
  // 旧存档：真正比牌默认双方亮；弃牌赢不亮
  if (state.street === 'showdown' && !state.folded) return { her: true, me: true }
  return { her: false, me: false }
}

function inferReadyNext(state: {
  readyNext?: Record<NoteAbout, boolean>
}): Record<NoteAbout, boolean> {
  const cur = state.readyNext
  if (
    cur &&
    typeof cur.her === 'boolean' &&
    typeof cur.me === 'boolean'
  ) {
    return { her: cur.her, me: cur.me }
  }
  return { her: false, me: false }
}

/** 旧存档没有 committed 时，至少用本街注额兜底 */
function inferCommitted(state: {
  betThisRound: Record<NoteAbout, number>
  committed?: Record<NoteAbout, number>
}): Record<NoteAbout, number> {
  const cur = state.committed
  if (
    cur &&
    typeof cur.her === 'number' &&
    typeof cur.me === 'number'
  ) {
    return { her: cur.her, me: cur.me }
  }
  return {
    her: state.betThisRound.her,
    me: state.betThisRound.me,
  }
}

/** 旧存档没有 raisedThisStreet 时，按注额与加注次数推断 */
function inferRaisedThisStreet(state: {
  betThisRound: Record<NoteAbout, number>
  raisesThisStreet?: number
  raisedThisStreet?: Record<NoteAbout, boolean>
}): Record<NoteAbout, boolean> {
  const cur = state.raisedThisStreet
  if (
    cur &&
    typeof cur.her === 'boolean' &&
    typeof cur.me === 'boolean'
  ) {
    return { her: cur.her, me: cur.me }
  }
  const raises = state.raisesThisStreet ?? 0
  if (raises <= 0) return { her: false, me: false }
  if (raises >= 2) return { her: true, me: true }
  const herBet = state.betThisRound.her
  const meBet = state.betThisRound.me
  if (herBet > meBet) return { her: true, me: false }
  if (meBet > herBet) return { her: false, me: true }
  return { her: false, me: false }
}

/** 旧存档没有 actedThisStreet 时，按当前注额/行动权推断 */
function inferActedThisStreet(state: {
  toAct: NoteAbout
  betThisRound: Record<NoteAbout, number>
  actedThisStreet?: Record<NoteAbout, boolean>
}): Record<NoteAbout, boolean> {
  const cur = state.actedThisStreet
  if (
    cur &&
    typeof cur.her === 'boolean' &&
    typeof cur.me === 'boolean'
  ) {
    return { her: cur.her, me: cur.me }
  }
  const herBet = state.betThisRound.her
  const meBet = state.betThisRound.me
  if (herBet !== meBet) {
    return herBet > meBet ? { her: true, me: false } : { her: false, me: true }
  }
  const other: NoteAbout = state.toAct === 'her' ? 'me' : 'her'
  return { [state.toAct]: false, [other]: true } as Record<NoteAbout, boolean>
}

function matchWinner(stacks: Record<NoteAbout, number>): NoteAbout | null {
  if (stacks.her <= 0 && stacks.me <= 0) return null
  if (stacks.her <= 0) return 'me'
  if (stacks.me <= 0) return 'her'
  return null
}

function withMatchOver(state: PublicState): PublicState {
  const winner = matchWinner(state.stacks)
  if (!winner) return state
  return {
    ...state,
    matchOver: true,
    result: state.result
      ? `${state.result} · 整局结束`
      : `${aboutLabel(winner)} 赢下整局（对方筹码耗尽）`,
  }
}

/** 已经有人 All-in，且对方注额不少于该 All-in，后面没有可行动作 */
function actionClosed(state: PublicState): boolean {
  const herBet = state.betThisRound.her
  const meBet = state.betThisRound.me
  const herBroke = state.stacks.her <= 0
  const meBroke = state.stacks.me <= 0
  if (herBroke && meBroke) return true
  if (herBroke && meBet >= herBet) return true
  if (meBroke && herBet >= meBet) return true
  return false
}

type Msg =
  | { type: 'hello'; who: NoteAbout }
  | { type: 'need-sync' }
  | {
      type: 'deal' | 'state'
      seq?: number
      handId?: number
      public: PublicState
      holes?: Record<NoteAbout, Card[]>
      /** 重连/补同步：加入方必须收下，不能因本地 seq 更高拒收 */
      sync?: boolean
    }
  | { type: 'action'; who: NoteAbout; kind: 'fold' | 'check' | 'call' | 'raise'; amount?: number }
  | { type: 'show-hole'; who: NoteAbout }
  | { type: 'ready-next'; who: NoteAbout }

const STREET_LABEL: Record<Street, string> = {
  preflop: '翻前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '比牌',
}

function CardView({
  card,
  hidden,
  size = 'md',
}: {
  card?: Card
  hidden?: boolean
  size?: 'sm' | 'md'
}) {
  const box =
    size === 'sm'
      ? 'h-10 w-[1.85rem] rounded text-[0.65rem] sm:h-12 sm:w-9 sm:text-xs'
      : 'h-11 w-8 rounded-md text-xs sm:h-14 sm:w-10 sm:text-sm'
  if (hidden || !card) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center bg-[var(--leaf)] font-semibold text-[var(--foam)] ${box}`}
      >
        ?
      </span>
    )
  }
  const red = cardColor(card) === 'red'
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center justify-center bg-white font-semibold shadow-sm',
        box,
        red ? 'text-[#b42318]' : 'text-[var(--cork-ink)]',
      ].join(' ')}
    >
      {formatCard(card)}
    </span>
  )
}

export function PokerPage() {
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [pub, setPub] = useState<PublicState | null>(null)
  const [myHole, setMyHole] = useState<Card[]>([])
  const [showAll, setShowAll] = useState(false)
  const [peerHole, setPeerHole] = useState<Card[]>([])
  const [betAmount, setBetAmount] = useState(0)
  const [eggFlash, setEggFlash] = useState<EggFlash | null>(null)

  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  const peerWhoRef = useRef<NoteAbout | null>(null)
  const holesRef = useRef<Record<NoteAbout, Card[]>>({ her: [], me: [] })
  const pubRef = useRef<PublicState | null>(null)
  const codeRef = useRef('')
  const isHostRef = useRef(false)
  const handIdRef = useRef(0)
  const seqRef = useRef(0)
  const seenSeqRef = useRef(0)
  const reenterRef = useRef(0)
  const reenterTimerRef = useRef(0)
  const deckRef = useRef<Card[]>([])
  const eggSeenRef = useRef('')
  const chipHoldRef = useRef(0)
  const chipLongRef = useRef(false)
  const wasMyTurnRef = useRef(false)
  whoRef.current = who
  peerWhoRef.current = peerWho
  pubRef.current = pub

  const navigate = useNavigate()
  const room = usePeerRoom()
  const leavingHubRef = useRef(false)

  usePeerSessionGuard(sessionRef, () => true)
  useEffect(
    () => () => {
      window.clearTimeout(reenterTimerRef.current)
      window.clearTimeout(chipHoldRef.current)
    },
    [],
  )

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!code) return null
    return {
      game: 'poker',
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
    'poker',
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
      codeRef.current = saved.code
      setCode(saved.code)
      isHostRef.current = saved.role === 'host'
      setIsHost(saved.role === 'host')
      if (isSavedPokerHand(saved.poker)) {
        restoreHand(saved.poker)
        setPhase('play')
      }
      if (saved.role === 'host') void create(saved.code)
      else void join(saved.code)
    },
  )

  function adoptLiveFromProvider() {
    const session = room.session
    if (!session) return
    room.bindHandlers(navHandlers(pokerHandlers()))
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
    setPhase(pubRef.current ? 'play' : 'wait')
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
    codeRef.current = saved.code
    setCode(saved.code)
    isHostRef.current = saved.role === 'host'
    setIsHost(saved.role === 'host')
    if (saved.role === 'host') void create(saved.code)
    else void join(saved.code)
  }

  function send(msg: Msg) {
    sessionRef.current?.send(msg)
  }

  function hello() {
    sessionRef.current?.sendReliable({ type: 'hello', who: whoRef.current })
  }

  function persistHand() {
    const state = pubRef.current
    const room = codeRef.current
    if (!state || !room) return
    savePeerRoom({
      game: 'poker',
      code: room,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
      poker: {
        handId: handIdRef.current,
        seq: Math.max(seqRef.current, seenSeqRef.current),
        public: state,
        holes: holesRef.current,
        deck: deckRef.current,
      },
    })
  }

  function restoreHand(hand: SavedPokerHand) {
    handIdRef.current = hand.handId
    seqRef.current = hand.seq
    seenSeqRef.current = hand.seq
    if (hand.deck.length > 0) deckRef.current = hand.deck
    holesRef.current = hand.holes
    applyPublic(hand.public, hand.holes)
  }

  function takeSeq(seq: unknown): boolean {
    if (typeof seq !== 'number' || !Number.isFinite(seq)) return true
    if (seq <= seenSeqRef.current) return false
    seenSeqRef.current = seq
    return true
  }

  /** 强制同步时也抬高本地 seq，避免后续包被旧水位挡住 */
  function adoptSeq(seq: unknown) {
    if (typeof seq !== 'number' || !Number.isFinite(seq)) return
    if (seq > seenSeqRef.current) seenSeqRef.current = seq
    if (seq > seqRef.current) seqRef.current = seq
  }

  /** 发给对方的底牌：自己的永远给；对方的仅在已亮牌时给 */
  function holesForPeer(): Record<NoteAbout, Card[]> {
    const holes = holesRef.current
    const state = pubRef.current
    const mine = whoRef.current
    const theirs: NoteAbout = mine === 'her' ? 'me' : 'her'
    const revealed = state ? inferRevealed(state) : { her: false, me: false }
    return {
      [theirs]: holes[theirs],
      [mine]: revealed[mine] ? holes[mine] : [],
    } as Record<NoteAbout, Card[]>
  }

  function broadcast(
    reliable: boolean,
    kind: 'deal' | 'state' = 'state',
    opts?: { sync?: boolean },
  ) {
    const state = pubRef.current
    const session = sessionRef.current
    if (!state || !session?.isHost) return
    seqRef.current += 1
    const msg: Msg = {
      type: kind,
      seq: seqRef.current,
      handId: handIdRef.current,
      public: state,
      holes: reliable || state.street === 'showdown' ? holesForPeer() : undefined,
      // 可靠包一律带 sync：刷新后加入方 seq 可能更高，不能拒收权威状态
      sync: reliable || opts?.sync ? true : undefined,
    }
    if (reliable) session.sendReliable(msg)
    else session.send(msg)
    persistHand()
  }

  /** 双方都点了下一手却仍停在比牌：补发一手（重连常见） */
  function hostEnsureDealIfReady(): boolean {
    const state = pubRef.current
    if (!state || state.street !== 'showdown') return false
    const ready = inferReadyNext(state)
    if (!ready.her || !ready.me) return false
    if (state.matchOver || matchWinner(state.stacks)) {
      dealHand(whoRef.current, true)
    } else {
      dealHand(state.button === 'her' ? 'me' : 'her', false)
    }
    return true
  }

  /** 房主把当前牌局强制推给对方（hello / need-sync / 重连） */
  function syncToPeer() {
    if (!sessionRef.current?.isHost || !pubRef.current) return
    // 还没对上身份时别推牌局：大厅里的人会被 state 干扰匹配
    if (!peerWhoRef.current) return
    if (hostEnsureDealIfReady()) return
    broadcast(true, 'state', { sync: true })
  }

  function onRoomOpen() {
    setError('')
    reenterRef.current = 0
    hello()
    if (sessionRef.current?.isHost) {
      // 等对方 poker hello 带上 peerWho 后再 syncToPeer
      return
    }
    // 刷新重连：丢掉偏高的本地 seq，准备收下房主权威状态
    seenSeqRef.current = 0
    sessionRef.current?.sendReliable({ type: 'need-sync' })
  }

  function onWake() {
    const session = sessionRef.current
    if (!session?.conn?.open) return
    hello()
    if (session.isHost) {
      // 仅身份已对齐时补同步，避免误推到还在大厅的对方
      syncToPeer()
      return
    }
    seenSeqRef.current = 0
    session.sendReliable({ type: 'need-sync' })
  }

  function reenter() {
    const room = codeRef.current
    if (!room || reenterTimerRef.current) return
    reenterRef.current += 1
    if (reenterRef.current > 8) {
      setError('连接断了，让对方也重新打开这局')
      return
    }
    setError('连接断了，正在重新进房…')
    reenterTimerRef.current = window.setTimeout(() => {
      reenterTimerRef.current = 0
      if (isHostRef.current) void create(room)
      else void join(room)
    }, 800 * reenterRef.current)
  }

  function applyPublic(
    next: Omit<
      PublicState,
      | 'actedThisStreet'
      | 'raisedThisStreet'
      | 'raisesThisStreet'
      | 'revealed'
      | 'readyNext'
      | 'committed'
    > & {
      actedThisStreet?: Record<NoteAbout, boolean>
      raisedThisStreet?: Record<NoteAbout, boolean>
      raisesThisStreet?: number
      revealed?: Record<NoteAbout, boolean>
      readyNext?: Record<NoteAbout, boolean>
      committed?: Record<NoteAbout, number>
    },
    holes?: Record<NoteAbout, Card[]>,
  ) {
    const normalized: PublicState = {
      ...next,
      committed: inferCommitted(next),
      actedThisStreet: inferActedThisStreet(next),
      raisedThisStreet: inferRaisedThisStreet(next),
      raisesThisStreet: next.raisesThisStreet ?? 0,
      revealed: inferRevealed(next),
      readyNext: inferReadyNext(next),
    }
    setPub(normalized)
    pubRef.current = normalized
    if (holes) {
      const mine = whoRef.current
      const opp: NoteAbout = mine === 'her' ? 'me' : 'her'
      // 空数组表示未亮/未发，保留本地已知底牌（自己的牌）
      holesRef.current = {
        her:
          holes.her && holes.her.length > 0 ? holes.her : holesRef.current.her,
        me: holes.me && holes.me.length > 0 ? holes.me : holesRef.current.me,
      }
      const myCards = holesRef.current[mine]
      if (myCards.length > 0) setMyHole(myCards)
      if (normalized.revealed[opp] && holesRef.current[opp].length > 0) {
        setPeerHole(holesRef.current[opp])
        setShowAll(true)
      } else {
        setShowAll(false)
        setPeerHole([])
      }
    } else {
      const opp: NoteAbout = whoRef.current === 'her' ? 'me' : 'her'
      if (normalized.revealed[opp] && holesRef.current[opp].length > 0) {
        setPeerHole(holesRef.current[opp])
        setShowAll(true)
      } else if (!normalized.revealed[opp]) {
        setShowAll(false)
        setPeerHole([])
      }
    }
    if (!isHostRef.current) persistHand()
  }

  function dealHand(button: NoteAbout, resetStacks = false) {
    const deck = freshDeck()
    const holes: Record<NoteAbout, Card[]> = {
      her: [deck.pop()!, deck.pop()!],
      me: [deck.pop()!, deck.pop()!],
    }
    const stacks = resetStacks
      ? { her: START_STACK, me: START_STACK }
      : (pubRef.current?.stacks ?? { her: START_STACK, me: START_STACK })

    // 有人破产则不能再开一手（除非整局重开）
    if (!resetStacks && matchWinner(stacks)) return
    handIdRef.current += 1

    const sb = button
    const bb: NoteAbout = button === 'her' ? 'me' : 'her'
    const nextStacks = { ...stacks }
    // 盲注最多扣到 0，短码 All-in 上盲，绝不扣成负数
    const sbPay = Math.min(SMALL_BLIND, Math.max(0, nextStacks[sb]))
    const bbPay = Math.min(BIG_BLIND, Math.max(0, nextStacks[bb]))
    nextStacks[sb] -= sbPay
    nextStacks[bb] -= bbPay
    const blinds = { [sb]: sbPay, [bb]: bbPay } as Record<NoteAbout, number>
    const next: PublicState = {
      street: 'preflop',
      board: [],
      pot: sbPay + bbPay,
      stacks: nextStacks,
      toAct: sb,
      betThisRound: { ...blinds },
      committed: { ...blinds },
      actedThisStreet: { her: false, me: false },
      raisedThisStreet: { her: false, me: false },
      raisesThisStreet: 0,
      folded: null,
      button,
      matchOver: false,
      revealed: { her: false, me: false },
      readyNext: { her: false, me: false },
      heroCallBy: null,
      egg: null,
    }
    // stash remaining deck on host via closure in ref
    deckRef.current = deck
    holesRef.current = holes
    const opened = actionClosed(next) ? runOut(next) : next
    applyPublic(opened, holes)
    broadcast(true, 'deal')
    setPhase('play')
  }

  function dealNext(state: PublicState): PublicState {
    const deck = deckRef.current
    const toAct: NoteAbout = state.button === 'her' ? 'me' : 'her'
    const fresh = {
      betThisRound: { her: 0, me: 0 },
      actedThisStreet: { her: false, me: false },
      raisedThisStreet: { her: false, me: false },
      raisesThisStreet: 0,
      toAct,
    }
    if (state.street === 'preflop') {
      return {
        ...state,
        ...fresh,
        street: 'flop',
        board: [deck.pop()!, deck.pop()!, deck.pop()!],
      }
    }
    if (state.street === 'flop') {
      return {
        ...state,
        ...fresh,
        street: 'turn',
        board: [...state.board, deck.pop()!],
      }
    }
    if (state.street === 'turn') {
      return {
        ...state,
        ...fresh,
        street: 'river',
        board: [...state.board, deck.pop()!],
      }
    }
    return showdown(state)
  }

  /** 短码 All-in 时，多出来的筹码退回，不进底池 */
  function refundUncalled(state: PublicState): PublicState {
    const herBet = state.betThisRound.her
    const meBet = state.betThisRound.me
    if (herBet === meBet) return state
    const stacks = { ...state.stacks }
    const betThisRound = { ...state.betThisRound }
    const committed = { ...inferCommitted(state) }
    let pot = state.pot
    const leader: NoteAbout = herBet > meBet ? 'her' : 'me'
    const extra = Math.abs(herBet - meBet)
    const back = Math.min(extra, pot)
    stacks[leader] += back
    pot -= back
    betThisRound[leader] -= back
    committed[leader] = Math.max(0, committed[leader] - back)
    return { ...state, stacks, pot, betThisRound, committed }
  }

  /** 有人已 All-in 且本街结束：一次发完剩余公共牌并比牌 */
  function runOut(state: PublicState): PublicState {
    let next = refundUncalled(state)
    do {
      next = dealNext(next)
    } while (next.street !== 'showdown')
    return next
  }

  function showdown(state: PublicState): PublicState {
    const holes = holesRef.current
    const her = bestHand(holes.her, state.board)
    const me = bestHand(holes.me, state.board)
    const cmp = compareHand(her, me)
    const stacks = { ...state.stacks }
    let result = ''
    let winner: NoteAbout | null = null
    if (cmp > 0) {
      stacks.her += state.pot
      result = `${aboutLabel('her')} 赢 · ${her.name}`
      winner = 'her'
    } else if (cmp < 0) {
      stacks.me += state.pot
      result = `${aboutLabel('me')} 赢 · ${me.name}`
      winner = 'me'
    } else {
      stacks.her += Math.floor(state.pot / 2)
      stacks.me += Math.ceil(state.pot / 2)
      result = `平分 · ${her.name}`
    }
    // 跟注对方 All-in 且赢下 → Hero Call
    const egg =
      winner && state.heroCallBy === winner ? ('hero-call' as const) : null
    return withMatchOver({
      ...state,
      street: 'showdown',
      stacks,
      pot: 0,
      result,
      toAct: state.button,
      revealed: { her: true, me: true },
      readyNext: { her: false, me: false },
      egg,
    })
  }

  function afterAction(
    state: PublicState,
    whoAct: NoteAbout,
    kind: 'check' | 'call' | 'raise',
  ): PublicState {
    const opp: NoteAbout = whoAct === 'her' ? 'me' : 'her'
    const actedThisStreet = {
      ...inferActedThisStreet(state),
      [whoAct]: true,
    }
    // 加注后对方必须再回应
    if (kind === 'raise') actedThisStreet[opp] = false

    const herBet = state.betThisRound.her
    const meBet = state.betThisRound.me
    const herBroke = state.stacks.her <= 0
    const meBroke = state.stacks.me <= 0
    const betsMatched =
      herBet === meBet ||
      (herBroke && meBet >= herBet) ||
      (meBroke && herBet >= meBet)
    // 已 All-in 的人不需要再行动
    const bothActed =
      (actedThisStreet.her || herBroke) && (actedThisStreet.me || meBroke)
    const streetDone = betsMatched && bothActed

    if (!streetDone) {
      return { ...state, actedThisStreet, toAct: opp }
    }
    const closed = { ...state, actedThisStreet }
    // 梭哈且注已跟平：直接发完剩余公共牌，不再逐街过牌/弃牌
    if (herBroke || meBroke) return runOut(closed)
    return dealNext(closed)
  }

  function hostApplyAction(
    whoAct: NoteAbout,
    kind: 'fold' | 'check' | 'call' | 'raise',
    amount = 0,
  ) {
    const state = pubRef.current
    if (!state || state.street === 'showdown' || state.folded) return
    if (state.toAct !== whoAct) return

    let next: PublicState = {
      ...state,
      stacks: { ...state.stacks },
      betThisRound: { ...state.betThisRound },
      committed: inferCommitted(state),
      actedThisStreet: inferActedThisStreet(state),
      raisedThisStreet: inferRaisedThisStreet(state),
      raisesThisStreet: state.raisesThisStreet ?? 0,
    }

    if (kind === 'fold') {
      const winner: NoteAbout = whoAct === 'her' ? 'me' : 'her'
      next.stacks[winner] += next.pot
      next = withMatchOver({
        ...next,
        folded: whoAct,
        pot: 0,
        street: 'showdown',
        result: `${aboutLabel(winner)} 赢（对手弃牌）`,
        revealed: { her: false, me: false },
        readyNext: { her: false, me: false },
        heroCallBy: null,
        egg: null,
      })
      applyPublic(next, holesRef.current)
      broadcast(true)
      return
    }

    const opp: NoteAbout = whoAct === 'her' ? 'me' : 'her'
    const toCall = Math.max(0, next.betThisRound[opp] - next.betThisRound[whoAct])
    const stackLeft = Math.max(0, next.stacks[whoAct])
    // 对方已 All-in，你选择跟注 → 记为 Hero Call 候选
    const facingAllIn = toCall > 0 && next.stacks[opp] <= 0

    if (kind === 'check') {
      if (toCall > 0) return
    } else if (kind === 'call') {
      const pay = Math.min(toCall, stackLeft)
      next.stacks[whoAct] -= pay
      next.betThisRound[whoAct] += pay
      next.committed[whoAct] += pay
      next.pot += pay
      if (facingAllIn) next.heroCallBy = whoAct
    } else if (kind === 'raise') {
      // 每人每街只能加注一次；对方加注后这边仍可再加一次
      if (next.raisedThisStreet[whoAct]) return
      if (stackLeft <= 0) return
      const minAdd = Math.min(stackLeft, toCall + BIG_BLIND)
      let pay = Math.floor(amount)
      if (!Number.isFinite(pay) || pay <= 0) return
      if (pay < minAdd && pay < stackLeft) pay = minAdd
      // 必须超过对方当前注额，否则只是跟注
      if (pay <= toCall && pay < stackLeft) return
      pay = Math.min(pay, stackLeft)
      next.stacks[whoAct] -= pay
      next.betThisRound[whoAct] += pay
      next.committed[whoAct] += pay
      next.pot += pay
      next.raisedThisStreet = { ...next.raisedThisStreet, [whoAct]: true }
      next.raisesThisStreet += 1
    }

    next = afterAction(next, whoAct, kind)
    applyPublic(next, holesRef.current)
    broadcast(next.street === 'showdown')
  }

  function hostShowHole(whoShow: NoteAbout) {
    const state = pubRef.current
    if (!state || state.street !== 'showdown') return
    if (state.revealed[whoShow]) return
    const revealed = { ...state.revealed, [whoShow]: true }
    let egg = state.egg ?? null
    // 弃牌后赢家亮牌，且确实比弃牌方大 → Nice Fold（双方同步）
    const folder = state.folded
    if (folder && whoShow !== folder && egg !== 'hero-call') {
      const holes = holesRef.current
      const folderHole = holes[folder]
      const showerHole = holes[whoShow]
      if (folderHole.length >= 2 && showerHole.length >= 2) {
        const folderHand = bestHand(folderHole, state.board)
        const showerHand = bestHand(showerHole, state.board)
        if (compareHand(showerHand, folderHand) > 0) egg = 'nice-fold'
      }
    }
    const next: PublicState = { ...state, revealed, egg }
    applyPublic(next, holesRef.current)
    broadcast(true)
  }

  function hostReadyNext(whoReady: NoteAbout) {
    const state = pubRef.current
    if (!state || state.street !== 'showdown') return
    if (state.readyNext[whoReady]) return
    const readyNext = { ...state.readyNext, [whoReady]: true }
    const next: PublicState = { ...state, readyNext }
    applyPublic(next)
    broadcast(true)
    if (readyNext.her && readyNext.me) {
      if (state.matchOver || matchWinner(state.stacks)) {
        dealHand(whoRef.current, true)
      } else {
        dealHand(state.button === 'her' ? 'me' : 'her', false)
      }
    }
  }

  async function goHub() {
    if (leavingHubRef.current) return
    leavingHubRef.current = true
    window.clearTimeout(reenterTimerRef.current)
    const roomCode = codeRef.current || code || room.code
    if (!roomCode) {
      navigate('/games', { replace: true })
      return
    }
    setBusy(true)
    setError('')
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

  function onData(raw: unknown) {
    const msg = raw as Msg
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return

    if (msg.type === 'hello') {
      peerWhoRef.current = msg.who
      setPeerWho(msg.who)
      reenterRef.current = 0
      if (sessionRef.current?.isHost) {
        syncToPeer()
      } else {
        const mine = otherAbout(msg.who)
        if (whoRef.current !== mine) {
          setWho(mine)
          whoRef.current = mine
          sessionRef.current?.sendReliable({ type: 'hello', who: mine })
          persistHand()
        }
        seenSeqRef.current = 0
        sessionRef.current?.sendReliable({ type: 'need-sync' })
      }
      return
    }
    if (msg.type === 'need-sync') {
      if (sessionRef.current?.isHost) syncToPeer()
      return
    }
    if (msg.type === 'deal' || msg.type === 'state') {
      if (sessionRef.current?.isHost) return
      // sync=true：重连补状态，即使本地 seq/handId 更高也要收下房主权威
      if (msg.sync) adoptSeq(msg.seq)
      else if (!takeSeq(msg.seq)) return
      if (typeof msg.handId === 'number') {
        if (!msg.sync && msg.handId < handIdRef.current) return
        if (msg.type === 'deal' || msg.handId !== handIdRef.current) {
          holesRef.current = { her: [], me: [] }
          setPeerHole([])
          setShowAll(false)
        }
        handIdRef.current = msg.handId
      }
      applyPublic(msg.public, msg.holes)
      setPhase('play')
      setError('')
      reenterRef.current = 0
      return
    }
    if (msg.type === 'action' && sessionRef.current?.isHost) {
      hostApplyAction(msg.who, msg.kind, msg.amount)
      return
    }
    if (msg.type === 'show-hole' && sessionRef.current?.isHost) {
      hostShowHole(msg.who)
      return
    }
    if (msg.type === 'ready-next' && sessionRef.current?.isHost) {
      hostReadyNext(msg.who)
    }
  }

  useEffect(() => {
    if (!isHost || !peerWho || phase !== 'wait') return
    if (pubRef.current) {
      syncToPeer()
      setPhase('play')
      return
    }
    hello()
    dealHand(whoRef.current)
  }, [isHost, peerWho, phase])

  function pokerHandlers() {
    return {
      onData,
      onOpen: onRoomOpen,
      onWake,
      onDisconnect: () => setError('对方暂时断线了，正在等他回来…'),
      onPeerLost: () => reenter(),
      onClose: () => setError('对方断开了'),
    }
  }

  function navHandlers(handlers: RoomHandlers) {
    return withHubNav(handlers, {
      navigate,
      sendReliable: (data, times) => room.sendReliable(data, times),
      hereGame: 'poker',
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

  function bindPokerSession(
    session: RoomSession,
    role: 'host' | 'joiner',
    kickOpen: boolean,
  ) {
    sessionRef.current = session
    room.attachSession(session, { who: whoRef.current })
    room.bindHandlers(navHandlers(pokerHandlers()))
    isHostRef.current = role === 'host'
    setIsHost(role === 'host')
    codeRef.current = session.code
    setCode(session.code)
    setPhase(pubRef.current ? 'play' : 'wait')
    savePeerRoom({
      game: 'poker',
      code: session.code,
      role,
      who: whoRef.current,
    })
    if (kickOpen && session.conn?.open) onRoomOpen()
  }

  async function create(existingCode?: string) {
    setBusy(true)
    if (!pubRef.current) setError('')
    isHostRef.current = true
    try {
      const handlers = navHandlers(pokerHandlers())
      if (existingCode) {
        const live = await adoptParkedSession(existingCode, true, handlers)
        if (live) {
          bindPokerSession(live, 'host', true)
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
      bindPokerSession(session, 'host', false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '开房失败')
    } finally {
      setBusy(false)
    }
  }

  async function join(roomCode: string) {
    setBusy(true)
    if (!pubRef.current) setError('')
    isHostRef.current = false
    try {
      const handlers = navHandlers(pokerHandlers())
      const live = await adoptParkedSession(roomCode, false, handlers)
      if (live) {
        bindPokerSession(live, 'joiner', true)
        return
      }
      sessionRef.current?.destroy()
      sessionRef.current = null
      await releaseParkedRoom(roomCode)
      const session = await joinPeerRoom(roomCode, handlers)
      bindPokerSession(session, 'joiner', false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加入失败')
    } finally {
      setBusy(false)
    }
  }

  function act(kind: 'fold' | 'check' | 'call' | 'raise', chips = 0) {
    if (!pub || pub.toAct !== who || pub.street === 'showdown') return
    setError('')
    if (isHost) {
      hostApplyAction(who, kind, chips)
    } else {
      send({ type: 'action', who, kind, amount: chips })
    }
    if (kind === 'raise') setBetAmount(0)
  }

  function showMyHole() {
    if (!pub || pub.street !== 'showdown' || pub.revealed[who]) return
    if (isHost) hostShowHole(who)
    else sessionRef.current?.sendReliable({ type: 'show-hole', who })
  }

  function readyForNext() {
    if (!pub || pub.street !== 'showdown' || pub.readyNext[who]) return
    if (isHost) hostReadyNext(who)
    else sessionRef.current?.sendReliable({ type: 'ready-next', who })
  }

  const opp = who === 'her' ? 'me' : 'her'
  const toCall = pub
    ? Math.max(0, pub.betThisRound[opp] - pub.betThisRound[who])
    : 0
  const myStack = pub ? Math.max(0, pub.stacks[who]) : 0
  const myTurn =
    !!pub &&
    pub.toAct === who &&
    pub.street !== 'showdown' &&
    !pub.folded &&
    !pub.matchOver &&
    myStack > 0
  // 对方加注后可跟或再加；每人每街只能加一次
  const canRaise =
    !!pub &&
    myStack > toCall &&
    !inferRaisedThisStreet(pub)[who]
  const minRaiseAdd = Math.min(myStack, toCall + BIG_BLIND)
  const matchDone = !!pub && (!!pub.matchOver || !!matchWinner(pub.stacks))
  const myCommitted = pub ? inferCommitted(pub)[who] : 0
  const foldLose = myCommitted
  // 当前若跟注/加注后拿下底池，能拿到多少
  const addNow =
    betAmount > 0 ? Math.min(betAmount, myStack) : toCall > 0 ? Math.min(toCall, myStack) : 0
  const winTake = pub ? pub.pot + addNow : 0

  // 刚轮到你时默认填最小加注；离开回合清零（不中途覆盖玩家已调金额）
  useEffect(() => {
    if (!myTurn) {
      wasMyTurnRef.current = false
      setBetAmount(0)
      return
    }
    if (!wasMyTurnRef.current) {
      setBetAmount(minRaiseAdd)
      wasMyTurnRef.current = true
    }
  }, [myTurn, minRaiseAdd])

  function triggerEgg(kind: EggFlash, token: string) {
    if (eggSeenRef.current === token) return
    eggSeenRef.current = token
    setEggFlash(kind)
  }

  // Hero Call / Nice Fold：公共状态同步，双方都展示；本手内不自动消失
  useEffect(() => {
    if (!pub?.egg) return
    if (pub.egg !== 'hero-call' && pub.egg !== 'nice-fold') return
    triggerEgg(pub.egg, `${handIdRef.current}:${pub.egg}`)
  }, [pub?.egg])

  // 新手牌清彩蛋
  useEffect(() => {
    if (!pub || pub.street === 'showdown') return
    eggSeenRef.current = ''
    setEggFlash(null)
  }, [pub?.street, pub?.button])

  function clampBet(n: number) {
    return Math.max(minRaiseAdd, Math.min(myStack, Math.floor(n)))
  }

  function addChip(value: number) {
    if (!myTurn || !canRaise) return
    setError('')
    setBetAmount((prev) => clampBet((prev > 0 ? prev : minRaiseAdd) + value))
  }

  /** 点错筹码：按该面额往回减，不低于最小加注 */
  function subChip(value: number) {
    if (!myTurn || !canRaise) return
    setError('')
    setBetAmount((prev) => clampBet((prev > 0 ? prev : minRaiseAdd) - value))
  }

  function nudgeBet(delta: number) {
    if (!myTurn || !canRaise) return
    setError('')
    setBetAmount((prev) => clampBet((prev > 0 ? prev : minRaiseAdd) + delta))
  }

  function clearBet() {
    setBetAmount(minRaiseAdd)
    setError('')
  }

  function submitRaise() {
    const n = Math.floor(betAmount)
    if (!Number.isFinite(n) || n <= 0) {
      setError(`点筹码加注（至少 ${minRaiseAdd}）`)
      return
    }
    if (n < minRaiseAdd && n < myStack) {
      setError(`加注至少再下 ${minRaiseAdd}`)
      return
    }
    act('raise', Math.min(n, myStack))
  }

  const shownBet = betAmount > 0 ? betAmount : minRaiseAdd

  const inPlay = phase === 'play' && !!pub

  // 对局中锁滚动，手机端单屏不上下滑
  useEffect(() => {
    if (!inPlay) return
    const html = document.documentElement
    const body = document.body
    const scrollY = window.scrollY
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
    }
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    return () => {
      html.style.overflow = prev.htmlOverflow
      body.style.overflow = prev.bodyOverflow
      body.style.position = prev.bodyPosition
      body.style.top = prev.bodyTop
      body.style.width = prev.bodyWidth
      window.scrollTo(0, scrollY)
    }
  }, [inPlay])

  return (
    <GameShell
      title="双人德州"
      compact={inPlay}
      dense={inPlay}
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

      {phase === 'wait' ? (
        <>
          <RoomBanner
            code={code}
            detail={
              peerWho
                ? `你是${aboutLabel(who)} · 对方${aboutLabel(peerWho)}`
                : `你是${aboutLabel(who)} · 等待对方…`
            }
          />
          <p className="text-sm text-[var(--ink-soft)]">
            {isHost ? '等对方进来发牌' : '已进房，等房主发牌…'}
          </p>
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        </>
      ) : null}

      {inPlay && pub ? (
        <div className="poker-table">
          <div className="poker-matchbar">
            <span>
              {aboutLabel(opp)}{' '}
              <strong className="font-display text-[var(--cork-ink)]">
                {Math.max(0, pub.stacks[opp])}
              </strong>
            </span>
            <span>
              你{' '}
              <strong className="font-display text-[var(--leaf)]">
                {Math.max(0, pub.stacks[who])}
              </strong>
            </span>
          </div>

          <div className="poker-seat">
            <p className="poker-seat-label">{aboutLabel(opp)}</p>
            <div className="poker-hole">
              <CardView card={peerHole[0]} hidden={!showAll} size="sm" />
              <CardView card={peerHole[1]} hidden={!showAll} size="sm" />
            </div>
          </div>

          <div className="poker-felt">
            <p className="poker-pot">
              底池 {pub.pot}
              <span>· {STREET_LABEL[pub.street]}</span>
            </p>
            {pub.street !== 'showdown' && (winTake > 0 || foldLose > 0) ? (
              <p className="poker-stakes" aria-live="polite">
                <span className="poker-stakes-win">赢 {winTake}</span>
                <span className="poker-stakes-sep" aria-hidden>
                  ·
                </span>
                <span className="poker-stakes-fold">弃 −{foldLose}</span>
              </p>
            ) : null}
            <div className="poker-board">
              {pub.board.length === 0 ? (
                <span className="text-sm text-white/55">等待公共牌</span>
              ) : (
                pub.board.map((c, i) => (
                  <CardView key={`${formatCard(c)}-${i}`} card={c} size="sm" />
                ))
              )}
            </div>
            {eggFlash ? (
              <div
                className={`poker-egg poker-egg-${eggFlash}`}
                key={`${eggFlash}-${eggSeenRef.current}`}
                role="status"
              >
                <span className="poker-egg-stamp">
                  {eggFlash === 'hero-call' ? 'HERO CALL' : 'NICE FOLD'}
                </span>
              </div>
            ) : null}
          </div>

          <div className="poker-seat">
            <p className="poker-seat-label text-[var(--leaf)]">你</p>
            <div className="poker-hole">
              <CardView card={myHole[0]} size="sm" />
              <CardView card={myHole[1]} size="sm" />
            </div>
          </div>

          {pub.result ? (
            <p className="poker-turn font-display text-[var(--leaf)]">
              {pub.result}
            </p>
          ) : (
            <p className="poker-turn text-[var(--ink-soft)]">
              {myTurn ? '轮到你' : `等待 ${aboutLabel(pub.toAct)}`}
            </p>
          )}

          <div className="poker-actions">
            {pub.street === 'showdown' ? (
              <div className="w-full space-y-2">
                {pub.folded ? (
                  <button
                    type="button"
                    disabled={pub.revealed[who]}
                    onClick={showMyHole}
                    className="game-btn game-btn-ghost game-btn-sm w-full"
                  >
                    {pub.revealed[who]
                      ? pub.revealed[opp]
                        ? '已亮牌'
                        : '已亮牌 · 对方可不亮'
                      : '亮牌'}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy || pub.readyNext[who]}
                  onClick={readyForNext}
                  className="game-btn game-btn-leaf game-btn-sm w-full"
                >
                  {pub.readyNext[who]
                    ? pub.readyNext[opp]
                      ? '发牌中…'
                      : '等对方确认'
                    : matchDone
                      ? '再来一局'
                      : '下一手'}
                </button>
              </div>
            ) : (
              <div
                className={[
                  'poker-act-panel space-y-2',
                  myTurn ? '' : 'is-wait',
                ].join(' ')}
              >
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={!myTurn}
                    onClick={() => act('fold')}
                    className="game-btn game-btn-danger game-btn-sm"
                  >
                    {foldLose > 0 ? `弃牌 −${foldLose}` : '弃牌'}
                  </button>
                  <button
                    type="button"
                    disabled={!myTurn}
                    onClick={() => act(toCall > 0 ? 'call' : 'check')}
                    className="game-btn game-btn-ghost game-btn-sm"
                  >
                    {toCall > 0 ? `跟 ${toCall}` : '过牌'}
                  </button>
                </div>

                <div className={['poker-raise', canRaise ? '' : 'is-locked'].join(' ')}>
                  <div className="poker-raise-sum">
                    <span className="poker-raise-label">
                      再下
                      <em>≥{minRaiseAdd}</em>
                    </span>
                    <div className="poker-raise-steer">
                      <button
                        type="button"
                        className="poker-raise-nudge"
                        disabled={!myTurn || !canRaise || shownBet <= minRaiseAdd}
                        onClick={() => nudgeBet(-RAISE_NUDGE)}
                        aria-label={`减 ${RAISE_NUDGE}`}
                      >
                        −
                      </button>
                      <strong className="poker-raise-amount font-display">
                        {shownBet}
                      </strong>
                      <button
                        type="button"
                        className="poker-raise-nudge"
                        disabled={!myTurn || !canRaise || shownBet >= myStack}
                        onClick={() => nudgeBet(RAISE_NUDGE)}
                        aria-label={`加 ${RAISE_NUDGE}`}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={!myTurn || !canRaise || shownBet <= minRaiseAdd}
                      onClick={clearBet}
                      className="poker-raise-clear"
                    >
                      重置
                    </button>
                  </div>
                  <div className="poker-chips" role="group" aria-label="筹码">
                    {RAISE_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        className={`poker-chip poker-chip-${chip}`}
                        disabled={!myTurn || !canRaise}
                        onPointerDown={() => {
                          if (!myTurn || !canRaise) return
                          chipLongRef.current = false
                          window.clearTimeout(chipHoldRef.current)
                          chipHoldRef.current = window.setTimeout(() => {
                            chipLongRef.current = true
                            subChip(chip)
                          }, 380)
                        }}
                        onPointerUp={() => {
                          window.clearTimeout(chipHoldRef.current)
                          if (chipLongRef.current) return
                          if (shownBet >= myStack) return
                          addChip(chip)
                        }}
                        onPointerCancel={() => {
                          window.clearTimeout(chipHoldRef.current)
                        }}
                        onPointerLeave={() => {
                          window.clearTimeout(chipHoldRef.current)
                        }}
                        aria-label={`加 ${chip}，长按减 ${chip}`}
                      >
                        <span className="poker-chip-ring" aria-hidden />
                        <span className="poker-chip-val">+{chip}</span>
                      </button>
                    ))}
                  </div>
                  <p className="poker-raise-tip">点筹码加 · 长按减 · ±{RAISE_NUDGE} 微调</p>
                  <button
                    type="button"
                    onClick={submitRaise}
                    disabled={!myTurn || !canRaise || shownBet <= 0}
                    className="game-btn game-btn-leaf game-btn-sm w-full"
                  >
                    加注 {shownBet}
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!myTurn || !canRaise}
                  onClick={() => act('raise', myStack)}
                  className="game-btn game-btn-ink game-btn-sm w-full"
                >
                  All-in（{myStack}）
                </button>
              </div>
            )}
          </div>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </GameShell>
  )
}
