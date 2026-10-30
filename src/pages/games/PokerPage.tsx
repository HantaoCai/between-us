import { useEffect, useRef, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { PeerLobby, RoomBanner } from '../../components/PeerLobby'
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
import {
  createPeerRoom,
  joinPeerRoom,
  type RoomSession,
} from '../../lib/peerRoom'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import {
  savePeerRoom,
  useFlushPeerRoomOnLeave,
} from '../../lib/peerRoomSave'
import { useConfirmLeaveGame } from '../../lib/useConfirmLeaveGame'
import { useResumePeerRoom } from '../../lib/useResumePeerRoom'

type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
type Phase = 'lobby' | 'wait' | 'play'

type PublicState = {
  street: Street
  board: Card[]
  pot: number
  stacks: Record<NoteAbout, number>
  toAct: NoteAbout
  betThisRound: Record<NoteAbout, number>
  /** 本街已加注次数；简化规则最多 1 次，不能互相一直加 */
  raisesThisStreet: number
  folded: NoteAbout | null
  button: NoteAbout
  result?: string
}

type Msg =
  | { type: 'hello'; who: NoteAbout }
  | { type: 'deal'; public: PublicState; holes: Record<NoteAbout, Card[]> }
  | { type: 'state'; public: PublicState; holes?: Record<NoteAbout, Card[]> }
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
  whoRef.current = who
  pubRef.current = pub

  useConfirmLeaveGame(phase !== 'lobby')

  useEffect(() => () => sessionRef.current?.destroy(), [])

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!code) return null
    return {
      game: 'poker',
      code,
      role: isHost ? 'host' : 'joiner',
      who: whoRef.current,
    }
  })

  useResumePeerRoom('poker', (saved) => {
    setBusy(true)
    setError('')
    whoRef.current = saved.who
    setWho(saved.who)
    if (saved.role === 'host') void create(saved.code)
    else void join(saved.code)
  })

  function send(msg: Msg) {
    sessionRef.current?.send(msg)
  }

  function hello() {
    sessionRef.current?.sendReliable({ type: 'hello', who: whoRef.current })
  }

  function applyPublic(next: PublicState, holes?: Record<NoteAbout, Card[]>) {
    setPub(next)
    pubRef.current = next
    if (holes) {
      holesRef.current = holes
      setMyHole(holes[whoRef.current] || [])
      if (next.street === 'showdown') {
        setPeerHole(holes[whoRef.current === 'her' ? 'me' : 'her'] || [])
        setShowAll(true)
      } else {
        setShowAll(false)
        setPeerHole([])
      }
    }
  }

  function dealHand(button: NoteAbout) {
    const deck = freshDeck()
    const holes: Record<NoteAbout, Card[]> = {
      her: [deck.pop()!, deck.pop()!],
      me: [deck.pop()!, deck.pop()!],
    }
    const stacks = pubRef.current?.stacks ?? { her: START_STACK, me: START_STACK }
    const sb = button
    const bb: NoteAbout = button === 'her' ? 'me' : 'her'
    const nextStacks = { ...stacks }
    nextStacks[sb] -= SMALL_BLIND
    nextStacks[bb] -= BIG_BLIND
    const next: PublicState = {
      street: 'preflop',
      board: [],
      pot: SMALL_BLIND + BIG_BLIND,
      stacks: nextStacks,
      toAct: sb,
      betThisRound: { [sb]: SMALL_BLIND, [bb]: BIG_BLIND } as Record<NoteAbout, number>,
      raisesThisStreet: 0,
      folded: null,
      button,
    }
    // stash remaining deck on host via closure in ref
    deckRef.current = deck
    holesRef.current = holes
    applyPublic(next, holes)
    send({ type: 'deal', public: next, holes })
    setPhase('play')
  }

  const deckRef = useRef<Card[]>([])

  function advanceStreet(state: PublicState): PublicState {
    const deck = deckRef.current
    if (state.street === 'preflop') {
      return {
        ...state,
        street: 'flop',
        board: [deck.pop()!, deck.pop()!, deck.pop()!],
        betThisRound: { her: 0, me: 0 },
        raisesThisStreet: 0,
        toAct: state.button === 'her' ? 'me' : 'her',
      }
    }
    if (state.street === 'flop') {
      return {
        ...state,
        street: 'turn',
        board: [...state.board, deck.pop()!],
        betThisRound: { her: 0, me: 0 },
        raisesThisStreet: 0,
        toAct: state.button === 'her' ? 'me' : 'her',
      }
    }
    if (state.street === 'turn') {
      return {
        ...state,
        street: 'river',
        board: [...state.board, deck.pop()!],
        betThisRound: { her: 0, me: 0 },
        raisesThisStreet: 0,
        toAct: state.button === 'her' ? 'me' : 'her',
      }
    }
    return showdown(state)
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
    return {
      ...state,
      street: 'showdown',
      stacks,
      pot: 0,
      result,
      toAct: state.button,
    }
  }

  function afterAction(state: PublicState): PublicState {
    const herBet = state.betThisRound.her
    const meBet = state.betThisRound.me
    const herBroke = state.stacks.her === 0
    const meBroke = state.stacks.me === 0
    // 注额对齐，或一方已 All-in 且另一方注不少于对方 → 进下一街
    if (
      herBet === meBet ||
      (herBroke && meBet >= herBet) ||
      (meBroke && herBet >= meBet)
    ) {
      return advanceStreet(state)
    }
    const nextActor: NoteAbout = state.toAct === 'her' ? 'me' : 'her'
    return { ...state, toAct: nextActor }
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
      raisesThisStreet: state.raisesThisStreet ?? 0,
    }

    if (kind === 'fold') {
      const winner: NoteAbout = whoAct === 'her' ? 'me' : 'her'
      next.stacks[winner] += next.pot
      next = {
        ...next,
        folded: whoAct,
        pot: 0,
        street: 'showdown',
        result: `${aboutLabel(winner)} 赢（对手弃牌）`,
      }
      applyPublic(next, holesRef.current)
      send({ type: 'state', public: next, holes: holesRef.current })
      return
    }

    const opp: NoteAbout = whoAct === 'her' ? 'me' : 'her'
    const toCall = Math.max(0, next.betThisRound[opp] - next.betThisRound[whoAct])

    if (kind === 'check') {
      if (toCall > 0) return
    } else if (kind === 'call') {
      const pay = Math.min(toCall, next.stacks[whoAct])
      next.stacks[whoAct] -= pay
      next.betThisRound[whoAct] += pay
      next.pot += pay
    } else if (kind === 'raise') {
      // 每街最多加注一次；amount = 本次再投入的筹码
      if (next.raisesThisStreet >= 1) return
      const stack = next.stacks[whoAct]
      if (stack <= 0) return
      const minAdd = Math.min(stack, toCall + BIG_BLIND)
      let pay = Math.floor(amount)
      if (!Number.isFinite(pay) || pay <= 0) return
      if (pay < minAdd && pay < stack) pay = minAdd
      pay = Math.min(pay, stack)
      next.stacks[whoAct] -= pay
      next.betThisRound[whoAct] += pay
      next.pot += pay
      next.raisesThisStreet += 1
    }

    next = afterAction(next)
    applyPublic(next, holesRef.current)
    send({
      type: 'state',
      public: next,
      holes: next.street === 'showdown' ? holesRef.current : undefined,
    })
  }

  function onData(raw: unknown) {
    const msg = raw as Msg
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return

    if (msg.type === 'hello') {
      setPeerWho(msg.who)
      if (!sessionRef.current?.isHost) {
        const mine = otherAbout(msg.who)
        if (whoRef.current !== mine) {
          setWho(mine)
          whoRef.current = mine
          sessionRef.current?.sendReliable({ type: 'hello', who: mine })
        }
      }
      return
    }
    if (msg.type === 'deal' || msg.type === 'state') {
      applyPublic(msg.public, msg.holes)
      setPhase('play')
      return
    }
    if (msg.type === 'action' && sessionRef.current?.isHost) {
      hostApplyAction(msg.who, msg.kind, msg.amount)
    }
  }

  useEffect(() => {
    if (!isHost || !peerWho || phase !== 'wait') return
    hello()
    dealHand(whoRef.current)
  }, [isHost, peerWho, phase])

  async function create(existingCode?: string) {
    setBusy(true)
    setError('')
    try {
      sessionRef.current?.destroy()
      const session = await createPeerRoom(
        {
          onData,
          onOpen: () => {
            setError('')
            hello()
          },
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
        game: 'poker',
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
      const session = await joinPeerRoom(room, {
        onData,
        onOpen: () => {
          setError('')
          hello()
        },
        onDisconnect: () => setError('连接不稳，正在重连…'),
        onClose: () => setError('对方断开了'),
      })
      sessionRef.current = session
      setIsHost(false)
      setCode(session.code)
      setPhase('wait')
      savePeerRoom({
        game: 'poker',
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

  const myTurn = pub?.toAct === who && pub.street !== 'showdown' && !pub.folded
  const opp = who === 'her' ? 'me' : 'her'
  const toCall = pub
    ? Math.max(0, pub.betThisRound[opp] - pub.betThisRound[who])
    : 0
  const myStack = pub ? pub.stacks[who] : 0
  const canRaise = !!pub && (pub.raisesThisStreet ?? 0) < 1 && myStack > 0
  const minRaiseAdd = Math.min(myStack, toCall + BIG_BLIND)

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
    <GameShell title="简化德州" compact={inPlay}>
      {phase === 'lobby' ? (
        <PeerLobby
          busy={busy}
          error={error}
          who={who}
          onWho={setWho}
          onCreate={() => void create()}
          onJoin={(c) => void join(c)}
        />
      ) : null}

      {phase === 'wait' ? (
        <>
          <RoomBanner
            code={code}
            detail={
              peerWho
                ? `${aboutLabel(who)} vs ${aboutLabel(peerWho)}`
                : '等待对方…'
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
                {pub.stacks[opp]}
              </strong>
            </span>
            <span className="text-[var(--ink-soft)]">{code}</span>
            <span>
              {aboutLabel(who)}{' '}
              <strong className="font-display text-[var(--leaf)]">
                {pub.stacks[who]}
              </strong>
            </span>
          </div>

          <div className="poker-seat">
            <p className="poker-seat-label">对方</p>
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
            <p className="poker-seat-label">你的手牌</p>
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
              {myTurn ? '轮到你' : `等待 ${aboutLabel(pub.toAct)}`}
            </p>
          )}

          <div className="poker-actions">
            {pub.street === 'showdown' && isHost ? (
              <button
                type="button"
                onClick={() => dealHand(pub.button === 'her' ? 'me' : 'her')}
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
