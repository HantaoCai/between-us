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

type PublicState = {
  street: Street
  board: Card[]
  pot: number
  stacks: Record<NoteAbout, number>
  toAct: NoteAbout
  betThisRound: Record<NoteAbout, number>
  /** 本街谁已经行动过；双方都行动且注额对齐才进下一街 */
  actedThisStreet: Record<NoteAbout, boolean>
  /** 本街已加注次数；简化规则最多 1 次，不能互相一直加 */
  raisesThisStreet: number
  folded: NoteAbout | null
  button: NoteAbout
  result?: string
  /** 有一方筹码耗尽，整局结束 */
  matchOver?: boolean
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
    }
  | { type: 'action'; who: NoteAbout; kind: 'fold' | 'check' | 'call' | 'raise'; amount?: number }

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
  const [betInput, setBetInput] = useState('')

  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
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
  whoRef.current = who
  pubRef.current = pub

  const navigate = useNavigate()
  const room = usePeerRoom()
  const leavingHubRef = useRef(false)

  usePeerSessionGuard(sessionRef, () => true)
  useEffect(() => () => window.clearTimeout(reenterTimerRef.current), [])

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
    if (room.peerWho) setPeerWho(room.peerWho)
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

  function broadcast(reliable: boolean, kind: 'deal' | 'state' = 'state') {
    const state = pubRef.current
    const session = sessionRef.current
    if (!state || !session?.isHost) return
    seqRef.current += 1
    const msg: Msg = {
      type: kind,
      seq: seqRef.current,
      handId: handIdRef.current,
      public: state,
      holes: reliable || state.street === 'showdown' ? holesRef.current : undefined,
    }
    if (reliable) session.sendReliable(msg)
    else session.send(msg)
    persistHand()
  }

  function onRoomOpen() {
    setError('')
    reenterRef.current = 0
    hello()
    if (sessionRef.current?.isHost) {
      if (pubRef.current) broadcast(true)
      return
    }
    sessionRef.current?.sendReliable({ type: 'need-sync' })
  }

  function onWake() {
    const session = sessionRef.current
    if (!session?.conn?.open) return
    hello()
    if (session.isHost) {
      if (pubRef.current) broadcast(true)
      return
    }
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
    next: Omit<PublicState, 'actedThisStreet' | 'raisesThisStreet'> & {
      actedThisStreet?: Record<NoteAbout, boolean>
      raisesThisStreet?: number
    },
    holes?: Record<NoteAbout, Card[]>,
  ) {
    const normalized: PublicState = {
      ...next,
      actedThisStreet: inferActedThisStreet(next),
      raisesThisStreet: next.raisesThisStreet ?? 0,
    }
    setPub(normalized)
    pubRef.current = normalized
    if (holes) {
      holesRef.current = holes
      setMyHole(holes[whoRef.current] || [])
      if (normalized.street === 'showdown') {
        setPeerHole(holes[whoRef.current === 'her' ? 'me' : 'her'] || [])
        setShowAll(true)
      } else {
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
    const next: PublicState = {
      street: 'preflop',
      board: [],
      pot: sbPay + bbPay,
      stacks: nextStacks,
      toAct: sb,
      betThisRound: { [sb]: sbPay, [bb]: bbPay } as Record<NoteAbout, number>,
      actedThisStreet: { her: false, me: false },
      raisesThisStreet: 0,
      folded: null,
      button,
      matchOver: false,
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
    let pot = state.pot
    const leader: NoteAbout = herBet > meBet ? 'her' : 'me'
    const extra = Math.abs(herBet - meBet)
    const back = Math.min(extra, pot)
    stacks[leader] += back
    pot -= back
    betThisRound[leader] -= back
    return { ...state, stacks, pot, betThisRound }
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
    if (cmp > 0) {
      stacks.her += state.pot
      result = `${aboutLabel('her')} 赢 · ${her.name}`
    } else if (cmp < 0) {
      stacks.me += state.pot
      result = `${aboutLabel('me')} 赢 · ${me.name}`
    } else {
      stacks.her += Math.floor(state.pot / 2)
      stacks.me += Math.ceil(state.pot / 2)
      result = `平分 · ${her.name}`
    }
    return withMatchOver({
      ...state,
      street: 'showdown',
      stacks,
      pot: 0,
      result,
      toAct: state.button,
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
      actedThisStreet: inferActedThisStreet(state),
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
      })
      applyPublic(next, holesRef.current)
      broadcast(true)
      return
    }

    const opp: NoteAbout = whoAct === 'her' ? 'me' : 'her'
    const toCall = Math.max(0, next.betThisRound[opp] - next.betThisRound[whoAct])
    const stackLeft = Math.max(0, next.stacks[whoAct])

    if (kind === 'check') {
      if (toCall > 0) return
    } else if (kind === 'call') {
      const pay = Math.min(toCall, stackLeft)
      next.stacks[whoAct] -= pay
      next.betThisRound[whoAct] += pay
      next.pot += pay
    } else if (kind === 'raise') {
      // 每街最多加注一次；amount = 本次再投入的筹码
      if (next.raisesThisStreet >= 1) return
      if (stackLeft <= 0) return
      const minAdd = Math.min(stackLeft, toCall + BIG_BLIND)
      let pay = Math.floor(amount)
      if (!Number.isFinite(pay) || pay <= 0) return
      if (pay < minAdd && pay < stackLeft) pay = minAdd
      pay = Math.min(pay, stackLeft)
      next.stacks[whoAct] -= pay
      next.betThisRound[whoAct] += pay
      next.pot += pay
      next.raisesThisStreet += 1
    }

    next = afterAction(next, whoAct, kind)
    applyPublic(next, holesRef.current)
    broadcast(next.street === 'showdown')
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
      setPeerWho(msg.who)
      reenterRef.current = 0
      if (sessionRef.current?.isHost) {
        if (pubRef.current) broadcast(true)
      } else {
        const mine = otherAbout(msg.who)
        if (whoRef.current !== mine) {
          setWho(mine)
          whoRef.current = mine
          sessionRef.current?.sendReliable({ type: 'hello', who: mine })
          persistHand()
        }
        sessionRef.current?.sendReliable({ type: 'need-sync' })
      }
      return
    }
    if (msg.type === 'need-sync') {
      if (sessionRef.current?.isHost && pubRef.current) broadcast(true)
      return
    }
    if (msg.type === 'deal' || msg.type === 'state') {
      if (sessionRef.current?.isHost) return
      if (!takeSeq(msg.seq)) return
      if (typeof msg.handId === 'number') {
        if (msg.handId < handIdRef.current) return
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
    }
  }

  useEffect(() => {
    if (!isHost || !peerWho || phase !== 'wait') return
    if (pubRef.current) {
      broadcast(true)
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
      onDisconnect: () => setError('对方离开了，正在等他回来…'),
      onPeerLost: () => reenter(),
      onClose: () => setError('对方断开了'),
    }
  }

  function navHandlers(handlers: RoomHandlers) {
    return withHubNav(handlers, {
      navigate,
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
    if (kind === 'raise') setBetInput('')
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
  const canRaise = !!pub && (pub.raisesThisStreet ?? 0) < 1 && myStack > 0
  const minRaiseAdd = Math.min(myStack, toCall + BIG_BLIND)
  const matchDone = !!pub && (!!pub.matchOver || !!matchWinner(pub.stacks))

  function submitRaise() {
    const n = Math.floor(Number(betInput))
    if (!Number.isFinite(n) || n <= 0) {
      setError(`请输入下注额（至少 ${minRaiseAdd}）`)
      return
    }
    if (n < minRaiseAdd && n < myStack) {
      setError(`加注至少再下 ${minRaiseAdd}`)
      return
    }
    act('raise', Math.min(n, myStack))
  }

  const inPlay = phase === 'play' && !!pub

  return (
    <GameShell
      title="简化德州"
      compact={inPlay}
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
          <p className="text-center text-sm text-[var(--leaf)]">你是{aboutLabel(who)}</p>
          <div className="poker-matchbar">
            <span>
              {aboutLabel(opp)}{' '}
              <strong className="font-display text-[var(--cork-ink)]">
                {Math.max(0, pub.stacks[opp])}
              </strong>
            </span>
            <span className="text-[var(--ink-soft)]">{code}</span>
            <span>
              {aboutLabel(who)}{' '}
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
            <div className="poker-board">
              {pub.board.length === 0 ? (
                <span className="text-sm text-white/55">等待公共牌</span>
              ) : (
                pub.board.map((c, i) => (
                  <CardView key={`${formatCard(c)}-${i}`} card={c} size="sm" />
                ))
              )}
            </div>
          </div>

          <div className="poker-seat">
            <p className="poker-seat-label text-[var(--leaf)]">你 · {aboutLabel(who)}</p>
            <div className="poker-hole">
              <CardView card={myHole[0]} size="sm" />
              <CardView card={myHole[1]} size="sm" />
            </div>
          </div>

          {pub.result ? (
            <p className="text-center font-display text-lg text-[var(--leaf)]">
              {pub.result}
            </p>
          ) : (
            <p className="text-center text-sm text-[var(--ink-soft)]">
              {myTurn ? `轮到你 · ${aboutLabel(who)}` : `等待 ${aboutLabel(pub.toAct)}`}
            </p>
          )}

          <div className="poker-actions">
            {pub.street === 'showdown' && matchDone ? (
              <div className="w-full space-y-2">
                {isHost ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => dealHand(whoRef.current, true)}
                    className="game-btn game-btn-leaf game-btn-sm w-full"
                  >
                    再来一局
                  </button>
                ) : (
                  <p className="text-center text-xs text-[var(--ink-soft)]">
                    等开房的人再来一局
                  </p>
                )}
              </div>
            ) : null}
            {pub.street === 'showdown' && !matchDone && isHost ? (
              <button
                type="button"
                onClick={() =>
                  dealHand(pub.button === 'her' ? 'me' : 'her', false)
                }
                className="game-btn game-btn-leaf game-btn-sm w-full"
              >
                下一手
              </button>
            ) : null}

            {myTurn ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => act('fold')}
                    className="game-btn game-btn-danger game-btn-sm"
                  >
                    弃牌
                  </button>
                  <button
                    type="button"
                    onClick={() => act(toCall > 0 ? 'call' : 'check')}
                    className="game-btn game-btn-ghost game-btn-sm"
                  >
                    {toCall > 0 ? `跟 ${toCall}` : '过牌'}
                  </button>
                </div>

                {canRaise ? (
                  <>
                    <div className="game-lobby-join">
                      <input
                        value={betInput}
                        onChange={(e) =>
                          setBetInput(e.target.value.replace(/\D/g, '').slice(0, 5))
                        }
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder={`再下 ≥${minRaiseAdd}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitRaise()
                        }}
                      />
                      <button type="button" onClick={submitRaise}>
                        加注
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => act('raise', myStack)}
                      className="game-btn game-btn-ink game-btn-sm w-full"
                    >
                      All-in（{myStack}）
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </GameShell>
  )
}
