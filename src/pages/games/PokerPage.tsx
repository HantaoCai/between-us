import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GameShell } from '../../components/GameShell'
import { EnterRoomGate } from '../../components/EnterRoomGate'
import { RoomBanner } from '../../components/PeerLobby'
import { SpectatorBanner } from '../../components/SpectatorBanner'
import { leaveGameToHub } from '../../lib/hubNav'
import {
  applyPeerHelloIdentity,
  createLinkSync,
  createSeqGate,
  usePeerReenter,
  wrapGameHandlers,
} from '../../lib/gameSession'
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
import { createBotDriverForGame } from '../../lib/botDrivers'
import { isSoloPlay, isSoloRoomCode } from '../../lib/botRoomSession'
import { mountSoloBotSession } from '../../lib/bootSoloSession'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import {
  isSavedPokerHand,
  peerRoomMeta,
  readPeerRoom,
  savePlayPeerRoom,
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
  /** 谁已亮出底牌（双人局：比牌/弃牌后双方亮；弃牌还会发完河牌） */
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
  revealed?: Record<NoteAbout, boolean>
}): Record<NoteAbout, boolean> {
  // 双人局：摊牌（比牌或弃牌发完河牌后）一律双方亮
  if (state.street === 'showdown') return { her: true, me: true }
  const cur = state.revealed
  if (
    cur &&
    typeof cur.her === 'boolean' &&
    typeof cur.me === 'boolean'
  ) {
    return { her: cur.her, me: cur.me }
  }
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
  const [, setShowAll] = useState(false)
  const [peerHole, setPeerHole] = useState<Card[]>([])
  const [betAmount, setBetAmount] = useState(0)
  /** 新手牌刚发出时锁操作，避免「下一手」连点落到同位置的 All-in */
  const [actLocked, setActLocked] = useState(false)

  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  const peerWhoRef = useRef<NoteAbout | null>(null)
  const holesRef = useRef<Record<NoteAbout, Card[]>>({ her: [], me: [] })
  const pubRef = useRef<PublicState | null>(null)
  const codeRef = useRef('')
  const isHostRef = useRef(false)
  const handIdRef = useRef(0)
  const seqGateRef = useRef(createSeqGate())
  const deckRef = useRef<Card[]>([])
  const wasMyTurnRef = useRef(false)
  const actLockedRef = useRef(false)
  const actUnlockTimerRef = useRef<number | null>(null)
  const actPendingRef = useRef(false)
  whoRef.current = who
  peerWhoRef.current = peerWho
  pubRef.current = pub

  function lockActionsBriefly(ms = 750) {
    actLockedRef.current = true
    setActLocked(true)
    if (actUnlockTimerRef.current != null) {
      window.clearTimeout(actUnlockTimerRef.current)
    }
    actUnlockTimerRef.current = window.setTimeout(() => {
      actLockedRef.current = false
      setActLocked(false)
      actUnlockTimerRef.current = null
    }, ms)
  }

  useEffect(() => {
    return () => {
      if (actUnlockTimerRef.current != null) {
        window.clearTimeout(actUnlockTimerRef.current)
      }
    }
  }, [])

  const navigate = useNavigate()
  const room = usePeerRoom()
  const spectating = !!room.isSpectator
  const spectatingRef = useRef(spectating)
  spectatingRef.current = spectating
  const leavingHubRef = useRef(false)
  const peerOpsRef = useRef({
    create: async (_code: string) => {},
    join: async (_code: string) => {},
  })

  const { reenter, reset: resetReenter } = usePeerReenter({
    leavingHubRef,
    getCode: () => codeRef.current,
    isHost: () => isHostRef.current,
    create: (code) => peerOpsRef.current.create(code),
    join: (code) => peerOpsRef.current.join(code),
    onRetry: () => setError('连接断了，正在重新进房…'),
    onGiveUp: () => setError('连接断了，让对方也重新打开这局'),
  })

  usePeerSessionGuard(sessionRef, () => true)

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!code) return null
    const gate = seqGateRef.current
    const state = pubRef.current
    return {
      ...peerRoomMeta({
        game: 'poker',
        code,
        role: isHost ? 'host' : 'joiner',
        who: whoRef.current,
      }),
      poker: state
        ? {
            handId: handIdRef.current,
            seq: Math.max(gate.seq, gate.seen),
            public: state,
            holes: holesRef.current,
            deck: deckRef.current,
          }
        : null,
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
      if (isSoloPlay({ code: room.code, session: room.session })) {
        bootSoloSession(room.who, room.code)
        return
      }
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
    const driver = createBotDriverForGame('poker', {
      botWho: otherAbout(playerWho),
      playerWho,
    })
    const { session, botWho } = mountSoloBotSession({
      room,
      driver,
      playerWho,
      code: keepCode || codeRef.current || room.code,
      attach: false,
    })
    whoRef.current = playerWho
    setWho(playerWho)
    peerWhoRef.current = botWho
    setPeerWho(botWho)
    bindPokerSession(session, 'host', true)
    setBusy(false)
  }

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
    // 从大厅点同款「德州」回来：必须恢复旧手牌，否则会当成新开局再发牌
    const saved = readPeerRoom()
    if (
      saved &&
      saved.code === session.code &&
      isSavedPokerHand(saved.poker)
    ) {
      restoreHand(saved.poker)
      setPhase('play')
    } else {
      setPhase(pubRef.current ? 'play' : 'wait')
    }
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

  function hello() {
    sessionRef.current?.sendReliable({ type: 'hello', who: whoRef.current })
  }

  function persistHand() {
    const state = pubRef.current
    const roomCode = codeRef.current
    if (!state || !roomCode) return
    const gate = seqGateRef.current
    savePlayPeerRoom(
      {
        game: 'poker',
        code: roomCode,
        role: isHostRef.current ? 'host' : 'joiner',
        who: whoRef.current,
      },
      {
        poker: {
          handId: handIdRef.current,
          seq: Math.max(gate.seq, gate.seen),
          public: state,
          holes: holesRef.current,
          deck: deckRef.current,
        },
      },
    )
  }

  function restoreHand(hand: SavedPokerHand) {
    handIdRef.current = hand.handId
    seqGateRef.current.setSeq(hand.seq)
    if (hand.deck.length > 0) deckRef.current = hand.deck
    holesRef.current = hand.holes
    applyPublic(hand.public, hand.holes)
  }

  /**
   * 底牌下发：始终双手（旁观上帝视角要用）。
   * 对战端 UI 仍按 revealed 遮对方牌，不靠裁包保密。
   */
  function holesForPeer(): Record<NoteAbout, Card[]> {
    const holes = holesRef.current
    return { her: [...holes.her], me: [...holes.me] }
  }

  /**
   * 对局状态一律可靠发送。
   * sync 只用于主动补同步：普通行动包不能带 sync，否则 sendReliable 迟到的旧包
   * 会把已经进下一手的对方盖回上一手。
   */
  function broadcast(
    kind: 'deal' | 'state' = 'state',
    opts?: { sync?: boolean },
  ) {
    const state = pubRef.current
    const session = sessionRef.current
    if (!state || !session?.isHost) return
    const seq = seqGateRef.current.next()
    const forceSync = !!opts?.sync
    const msg: Msg = {
      type: kind,
      seq,
      handId: handIdRef.current,
      public: state,
      holes: holesForPeer(),
      sync: forceSync ? true : undefined,
    }
    session.sendReliable(msg)
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

  /**
   * 房主推权威状态。
   * force：对方 need-sync / 重连要盘，必须推当前局，不自动发下一手，也不卡 peerWho。
   */
  function syncToPeer(opts?: { force?: boolean }) {
    if (!sessionRef.current?.isHost || !pubRef.current) return
    if (!opts?.force && !peerWhoRef.current) return
    if (!opts?.force && hostEnsureDealIfReady()) return
    broadcast('state', { sync: true })
  }

  const linkSync = createLinkSync({
    hello,
    isHost: () => !!sessionRef.current?.isHost,
    peerKnown: () => !!peerWhoRef.current,
    // 对方切后台回来：强制推当前局（含期间本方已走的操作）
    hostPush: () => syncToPeer({ force: true }),
    joinerPull: () => {
      seqGateRef.current.resetSeen()
      sessionRef.current?.sendReliable({ type: 'need-sync' })
    },
    getSession: () => sessionRef.current,
    onClearError: () => setError(''),
    onResetReenter: resetReenter,
  })

  function onRoomOpen() {
    linkSync.onOpen()
  }

  function onWake() {
    linkSync.onWake()
  }

  function onPeerDisconnect() {
    if (!linkSync.onDisconnect()) return
    setError('对方暂时离开，你仍可操作；连上后会自动同步进度')
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
    const mine = whoRef.current
    const opp: NoteAbout = mine === 'her' ? 'me' : 'her'
    if (holes) {
      // 空数组表示未亮/未发，保留本地已知底牌（自己的牌）
      holesRef.current = {
        her:
          holes.her && holes.her.length > 0 ? holes.her : holesRef.current.her,
        me: holes.me && holes.me.length > 0 ? holes.me : holesRef.current.me,
      }
      const myCards = holesRef.current[mine]
      if (myCards.length > 0) setMyHole(myCards)
    }
    // 旁观上帝视角：双手始终亮
    if (spectatingRef.current) {
      setMyHole(holesRef.current[mine] ?? [])
      setPeerHole(holesRef.current[opp] ?? [])
      setShowAll(true)
    } else if (normalized.revealed[opp] && holesRef.current[opp].length > 0) {
      // 摊牌/已亮：用本地 holes 立刻亮出对方
      setPeerHole(holesRef.current[opp])
      setShowAll(true)
    } else if (!normalized.revealed[opp]) {
      setShowAll(false)
      setPeerHole([])
    }
    if (!isHostRef.current && !spectatingRef.current) persistHand()
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
      result: undefined,
    }
    // stash remaining deck on host via closure in ref
    deckRef.current = deck
    holesRef.current = holes
    const opened = actionClosed(next) ? runOut(next) : next
    applyPublic(opened, holes)
    actPendingRef.current = false
    // 与「下一手」同底边位：发牌当下立刻锁，别等 useEffect，否则连点会点到 All-in
    if (opened.street !== 'showdown') lockActionsBriefly()
    broadcast('deal')
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
      // 翻前弃：不硬发公共牌；翻后弃：保留已发出的 board，不补发剩余
      let egg: EggFlash | null = null
      try {
        const holes = holesRef.current
        const folderHole = holes[whoAct]
        const winnerHole = holes[winner]
        if (folderHole.length >= 2 && winnerHole.length >= 2) {
          const folderHand = bestHand(folderHole, next.board)
          const winnerHand = bestHand(winnerHole, next.board)
          if (compareHand(winnerHand, folderHand) > 0) egg = 'nice-fold'
        }
      } catch {
        /* ignore */
      }
      next = withMatchOver({
        ...next,
        folded: whoAct,
        pot: 0,
        street: 'showdown',
        result: `${aboutLabel(winner)} 赢（对手弃牌）`,
        revealed: { her: true, me: true },
        readyNext: { her: false, me: false },
        heroCallBy: null,
        egg,
      })
      applyPublic(next, holesRef.current)
      broadcast()
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
      if (!Number.isFinite(pay) || pay <= 0) pay = minAdd
      if (pay < minAdd && pay < stackLeft) pay = minAdd
      // 必须超过对方当前注额，否则只是跟注
      if (pay <= toCall && pay < stackLeft) {
        pay = Math.min(stackLeft, toCall + BIG_BLIND)
        if (pay <= toCall) return
      }
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
    broadcast()
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
    broadcast()
  }

  function hostReadyNext(whoReady: NoteAbout) {
    const state = pubRef.current
    if (!state || state.street !== 'showdown') return
    if (state.readyNext[whoReady]) return
    const readyNext = { ...state.readyNext, [whoReady]: true }
    const next: PublicState = { ...state, readyNext }
    applyPublic(next)
    broadcast()
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
    resetReenter()
    const roomCode = codeRef.current || code || room.code
    if (!roomCode) {
      leavingHubRef.current = false
      navigate('/games', { replace: true })
      return
    }
    setBusy(true)
    setError('')
    persistHand()
    try {
      await leaveGameToHub({
        sendReliable: (data, times) => room.sendReliable(data, times),
        code: roomCode,
        role: isHostRef.current ? 'host' : 'joiner',
        who: whoRef.current,
        navigate,
        fromGame: 'poker',
        onLocalLeave: () => {
          sessionRef.current = null
        },
      })
    } catch (e) {
      leavingHubRef.current = false
      setBusy(false)
      setError(e instanceof Error ? e.message : '回大厅失败，再试一次')
    }
  }

  function onData(raw: unknown) {
    const msg = raw as Msg
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return

    if (msg.type === 'hello') {
      setError('')
      resetReenter()
      const isHostNow = !!sessionRef.current?.isHost
      const { correctedWho } = applyPeerHelloIdentity({
        peerWho: msg.who,
        isHost: isHostNow,
        whoRef,
        setWho,
        setPeerWho: (w) => {
          peerWhoRef.current = w
          setPeerWho(w)
        },
        sendHello: (w) =>
          sessionRef.current?.sendReliable({ type: 'hello', who: w }),
      })
      if (correctedWho) persistHand()
      if (isHostNow) {
        // 对方刚 hello：按补同步推，避免 ensureDeal 在重连瞬间误发下一手
        syncToPeer({ force: true })
      } else {
        seqGateRef.current.resetSeen()
        sessionRef.current?.sendReliable({ type: 'need-sync' })
      }
      return
    }
    if (msg.type === 'need-sync') {
      // 重连方要盘：强制推当前局，勿因 peerWho 空或 ensureDeal 发下一手而推空
      if (sessionRef.current?.isHost) syncToPeer({ force: true })
      return
    }
    if (msg.type === 'deal' || msg.type === 'state') {
      if (sessionRef.current?.isHost) return
      const gate = seqGateRef.current
      if (msg.sync) {
        // 强制同步：新手牌优先；同一手才用 seq 挡迟到旧包
        const msgHand =
          typeof msg.handId === 'number' && Number.isFinite(msg.handId)
            ? msg.handId
            : null
        if (msgHand != null && msgHand < handIdRef.current) return
        const sameHand = msgHand == null || msgHand === handIdRef.current
        if (
          sameHand &&
          typeof msg.seq === 'number' &&
          Number.isFinite(msg.seq) &&
          msg.seq <= gate.seen
        ) {
          return
        }
        gate.adopt(msg.seq)
      } else if (!gate.take(msg.seq)) {
        return
      }
      let newHand = false
      if (typeof msg.handId === 'number') {
        if (!msg.sync && msg.handId < handIdRef.current) return
        newHand =
          msg.type === 'deal' || msg.handId !== handIdRef.current
        if (newHand) {
          holesRef.current = { her: [], me: [] }
          setPeerHole([])
          setShowAll(false)
        }
        handIdRef.current = msg.handId
      }
      applyPublic(msg.public, msg.holes)
      actPendingRef.current = false
      if (newHand && msg.public.street !== 'showdown') {
        lockActionsBriefly()
      }
      setPhase('play')
      setError('')
      resetReenter()
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

  // 客人卡在 wait：周期性要盘，避免房主已发牌/重进后自己收不到
  useEffect(() => {
    if (isHost || spectating || phase !== 'wait' || !code) return
    const pull = () => {
      if (!sessionRef.current?.conn?.open) return
      seqGateRef.current.resetSeen()
      hello()
      sessionRef.current.sendReliable({ type: 'need-sync' })
    }
    pull()
    const timer = window.setInterval(pull, 2500)
    return () => window.clearInterval(timer)
  }, [isHost, spectating, phase, code])

  function pokerHandlers() {
    return {
      onData,
      onOpen: onRoomOpen,
      onWake,
      onDisconnect: onPeerDisconnect,
      onPeerLost: () => reenter(),
      onClose: () => {
        if (sessionRef.current?.conn?.open) return
        setError('对方断开了')
      },
    }
  }

  function onSameGameRepick() {
    // 房主多次切回德州：客人可能仍停在 wait，需要重新要盘 / 房主补推
    room.bindHandlers(navHandlers(pokerHandlers()))
    setError('')
    resetReenter()
    if (isHostRef.current) {
      if (pubRef.current) {
        syncToPeer({ force: true })
        setPhase('play')
        return
      }
      if (peerWhoRef.current) {
        dealHand(whoRef.current, true)
        return
      }
      setPhase('wait')
      hello()
      return
    }
    // 客人：丢掉可能过期的本地手牌水位，向房主要权威局
    if (!pubRef.current) setPhase('wait')
    seqGateRef.current.resetSeen()
    hello()
    sessionRef.current?.sendReliable({ type: 'need-sync' })
  }

  function navHandlers(handlers: RoomHandlers) {
    return wrapGameHandlers(handlers, {
      hereGame: 'poker',
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
      onSameGameRepick: () => onSameGameRepick(),
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
    savePlayPeerRoom({
      game: 'poker',
      code: session.code,
      role,
      who: whoRef.current,
      mode: isSoloPlay({ code: session.code, session }) ? 'solo' : 'peer',
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

  peerOpsRef.current = { create, join }

  function act(kind: 'fold' | 'check' | 'call' | 'raise', chips = 0) {
    if (spectatingRef.current) return
    if (actLockedRef.current || actPendingRef.current) return
    if (!pub || pub.toAct !== who || pub.street === 'showdown') return
    setError('')
    actPendingRef.current = true
    if (isHost) {
      hostApplyAction(who, kind, chips)
      actPendingRef.current = false
    } else {
      sessionRef.current?.sendReliable({
        type: 'action',
        who,
        kind,
        amount: chips,
      })
    }
  }

  function readyForNext() {
    if (spectatingRef.current) return
    if (!pub || pub.street !== 'showdown' || pub.readyNext[who]) return
    if (isHost) {
      hostReadyNext(who)
      return
    }
    // 客人先本地亮「等对方」，避免卡顿连点；房主回包后再对齐
    applyPublic({
      ...pub,
      readyNext: { ...pub.readyNext, [who]: true },
    })
    sessionRef.current?.sendReliable({ type: 'ready-next', who })
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
  // 发牌瞬间 / 行动在途：按钮不可点，防止连点误 All-in
  const canPressAct = myTurn && !actLocked
  // 对方加注后可跟或再加；每人每街只能加一次
  const canRaise =
    !!pub &&
    myStack > toCall &&
    !inferRaisedThisStreet(pub)[who]
  // 跟注超过自己筹码：只能 All-in 跟注，不能显示「跟 1020」
  const callIsAllIn = toCall > 0 && myStack > 0 && myStack <= toCall
  const minRaiseAdd = Math.min(myStack, toCall + BIG_BLIND)
  const matchDone = !!pub && (!!pub.matchOver || !!matchWinner(pub.stacks))
  const myCommitted = pub ? inferCommitted(pub)[who] : 0
  const foldLose = myCommitted
  // 净赢 = 底池里对方已匹配的部分；短码 All-in 跟注时多出来的对手注会退回，不能算进可赢额
  const uncalledIfCall = Math.max(0, toCall - myStack)
  const netWin = pub ? Math.max(0, pub.pot - uncalledIfCall - foldLose) : 0

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

  function clampBet(n: number) {
    return Math.max(minRaiseAdd, Math.min(myStack, Math.floor(n)))
  }

  function addChip(value: number) {
    if (!canPressAct || !canRaise) return
    setError('')
    setBetAmount((prev) => clampBet((prev > 0 ? prev : minRaiseAdd) + value))
  }

  function nudgeBet(delta: number) {
    if (!canPressAct || !canRaise) return
    setError('')
    setBetAmount((prev) => clampBet((prev > 0 ? prev : minRaiseAdd) + delta))
  }

  function clearBet() {
    if (!canPressAct || !canRaise) return
    setBetAmount(minRaiseAdd)
    setError('')
  }

  function submitRaise() {
    if (!canPressAct) return
    // 与按钮展示一致：未点筹码时按最小加注提交，而不是报「点筹码」
    const n = Math.floor(betAmount > 0 ? betAmount : minRaiseAdd)
    if (!Number.isFinite(n) || n <= 0) {
      setError(`加注至少再下 ${minRaiseAdd}`)
      return
    }
    if (n < minRaiseAdd && n < myStack) {
      setError(`加注至少再下 ${minRaiseAdd}`)
      return
    }
    if (!canRaise) {
      setError('这街已经加过注了')
      return
    }
    act('raise', Math.min(n, myStack))
  }

  const shownBet = betAmount > 0 ? betAmount : minRaiseAdd
  // 旁观双手亮；对战摊牌以公共 revealed 为准
  const peerShown =
    spectating ||
    (!!pub && inferRevealed(pub)[opp] && peerHole.length >= 2)
  // 跟公共状态走：下一手 egg 清空后立刻消失，不另存本地 flash
  const eggKind: EggFlash | null =
    pub?.street === 'showdown' &&
    (pub.egg === 'hero-call' || pub.egg === 'nice-fold')
      ? pub.egg
      : null
  // Hero Call 挂在跟注 All-in 且赢的人；Nice Fold 挂在弃牌方
  const eggOwner: NoteAbout | null =
    eggKind === 'hero-call' && pub?.heroCallBy
      ? pub.heroCallBy
      : eggKind === 'nice-fold' && pub?.folded
        ? pub.folded
        : null

  const inPlay = phase === 'play' && !!pub

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
          {spectating ? <SpectatorBanner detail="等他们开打" /> : null}
          <RoomBanner
            code={code}
            detail={
              spectating
                ? '旁观中'
                : peerWho
                  ? `你是${aboutLabel(who)} · 对方${aboutLabel(peerWho)}`
                  : `你是${aboutLabel(who)} · 等待对方…`
            }
          />
          <p className="text-sm text-[var(--ink-soft)]">
            {spectating
              ? '对战席就位后自动发牌，你只看不玩'
              : isHost
                ? '等对方进来发牌'
                : '已进房，等房主发牌…'}
          </p>
          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        </>
      ) : null}

      {inPlay && pub ? (
        <div className="poker-table">
          {spectating ? (
            <div className="mb-1">
              <SpectatorBanner />
            </div>
          ) : null}
          <div className="poker-seat">
            <div className="poker-seat-meta">
              <p className="poker-seat-label">
                {spectating ? aboutLabel(opp) : `对方 · ${aboutLabel(opp)}`}
              </p>
              <strong className="poker-seat-stack font-display">
                {Math.max(0, pub.stacks[opp])}
              </strong>
            </div>
            {eggKind && eggOwner === opp ? (
              <div
                className={`poker-egg poker-egg-${eggKind}`}
                key={`egg-${handIdRef.current}-${eggKind}-opp`}
                role="status"
              >
                <span className="poker-egg-stamp">
                  {eggKind === 'hero-call' ? 'HERO CALL' : 'NICE FOLD'}
                </span>
              </div>
            ) : (
              <span className="poker-seat-gap" aria-hidden />
            )}
            <div className="poker-hole">
              <CardView card={peerHole[0]} hidden={!peerShown} size="sm" />
              <CardView card={peerHole[1]} hidden={!peerShown} size="sm" />
            </div>
          </div>

          <div className="poker-felt">
            <p className="poker-pot">
              底池 {pub.pot}
              <span>· {STREET_LABEL[pub.street]}</span>
            </p>
            {pub.street !== 'showdown' && (netWin > 0 || foldLose > 0) ? (
              <p className="poker-stakes" aria-live="polite">
                {netWin > 0 ? (
                  <span className="poker-stakes-win">净赢 +{netWin}</span>
                ) : null}
                {netWin > 0 && foldLose > 0 ? (
                  <span className="poker-stakes-sep" aria-hidden>
                    ·
                  </span>
                ) : null}
                {foldLose > 0 ? (
                  <span className="poker-stakes-fold">弃 −{foldLose}</span>
                ) : null}
              </p>
            ) : null}
            <div className="poker-board">
              {pub.board.length === 0 ? (
                <span className="text-sm text-white/55">
                  {pub.street === 'showdown' ? '未发公共牌' : '等待公共牌'}
                </span>
              ) : (
                pub.board.map((c, i) => (
                  <CardView key={`${formatCard(c)}-${i}`} card={c} size="sm" />
                ))
              )}
            </div>
          </div>

          <div className="poker-seat">
            <div className="poker-seat-meta">
              <p className="poker-seat-label text-[var(--leaf)]">
                {spectating ? aboutLabel(who) : `我方 · ${aboutLabel(who)}`}
              </p>
              <strong className="poker-seat-stack font-display text-[var(--leaf)]">
                {Math.max(0, pub.stacks[who])}
              </strong>
            </div>
            {eggKind && eggOwner === who ? (
              <div
                className={`poker-egg poker-egg-${eggKind}`}
                key={`egg-${handIdRef.current}-${eggKind}-me`}
                role="status"
              >
                <span className="poker-egg-stamp">
                  {eggKind === 'hero-call' ? 'HERO CALL' : 'NICE FOLD'}
                </span>
              </div>
            ) : (
              <span className="poker-seat-gap" aria-hidden />
            )}
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
              {spectating
                ? `等待 ${aboutLabel(pub.toAct)} 行动`
                : actLocked && myTurn
                  ? '发牌完成，稍候…'
                  : myTurn
                    ? '轮到你'
                    : `等待 ${aboutLabel(pub.toAct)}`}
            </p>
          )}

          {spectating ? (
            <p className="text-center text-xs text-[var(--ink-soft)]">
              旁观中，不能操作
            </p>
          ) : (
          <div className="poker-actions">
            {pub.street === 'showdown' ? (
              <div className="w-full space-y-2">
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
                  canPressAct ? '' : 'is-wait',
                ].join(' ')}
              >
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={!canPressAct}
                    onClick={() => act('fold')}
                    className="game-btn game-btn-danger game-btn-sm"
                  >
                    {foldLose > 0 ? `弃牌 −${foldLose}` : '弃牌'}
                  </button>
                  <button
                    type="button"
                    disabled={!canPressAct}
                    onClick={() => act(toCall > 0 ? 'call' : 'check')}
                    className={[
                      'game-btn game-btn-sm',
                      callIsAllIn ? 'game-btn-ink' : 'game-btn-ghost',
                    ].join(' ')}
                  >
                    {callIsAllIn
                      ? `All-in（${myStack}）`
                      : toCall > 0
                        ? `跟 ${toCall}`
                        : '过牌'}
                  </button>
                </div>

                <div className={['poker-raise', canRaise ? '' : 'is-locked'].join(' ')}>
                  <div className="poker-raise-sum">
                    <span className="poker-raise-label">再下</span>
                    <div className="poker-raise-steer">
                      <button
                        type="button"
                        className="poker-raise-nudge"
                        disabled={
                          !canPressAct || !canRaise || shownBet <= minRaiseAdd
                        }
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
                        disabled={
                          !canPressAct || !canRaise || shownBet >= myStack
                        }
                        onClick={() => nudgeBet(RAISE_NUDGE)}
                        aria-label={`加 ${RAISE_NUDGE}`}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={
                        !canPressAct || !canRaise || shownBet <= minRaiseAdd
                      }
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
                        disabled={
                          !canPressAct || !canRaise || shownBet >= myStack
                        }
                        onClick={() => addChip(chip)}
                        aria-label={`加 ${chip}`}
                      >
                        <span className="poker-chip-ring" aria-hidden />
                        <span className="poker-chip-val">+{chip}</span>
                      </button>
                    ))}
                  </div>
                  <p className="poker-raise-tip">点筹码加 · ±{RAISE_NUDGE} 微调</p>
                  <button
                    type="button"
                    onClick={submitRaise}
                    disabled={!canPressAct || !canRaise || shownBet <= 0}
                    className="game-btn game-btn-leaf game-btn-sm w-full"
                  >
                    加注 {shownBet}
                  </button>
                  {callIsAllIn ? null : (
                    <button
                      type="button"
                      disabled={!canPressAct || !canRaise}
                      onClick={() => act('raise', myStack)}
                      className="game-btn game-btn-ink game-btn-sm w-full"
                    >
                      All-in（{myStack}）
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          )}

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </GameShell>
  )
}
