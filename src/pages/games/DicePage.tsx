import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EnterRoomGate } from '../../components/EnterRoomGate'
import { GameShell } from '../../components/GameShell'
import { RoomBanner } from '../../components/PeerLobby'
import { assetUrl } from '../../lib/assetUrl'
import { aboutLabel, otherAbout, type NoteAbout } from '../../lib/notes'
import { leaveGameToHub, withHubNav } from '../../lib/hubNav'
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
import {
  clearPeerRoom,
  savePeerRoom,
  useFlushPeerRoomOnLeave,
} from '../../lib/peerRoomSave'
import { useConfirmLeaveGame } from '../../lib/useConfirmLeaveGame'
import { usePeerSessionGuard } from '../../lib/usePeerSessionGuard'
import { useGamePeerBoot } from '../../lib/useGamePeerBoot'

function coinPortraitUrl(owner: NoteAbout) {
  return assetUrl(
    owner === 'me' ? 'games/hantao-coin-heads.jpg' : 'games/jiajia-coin-heads.jpg',
  )
}

function coinTailsName(owner: NoteAbout) {
  return owner === 'me' ? 'Hantao' : 'JiaJia'
}

function rollDie() {
  return 1 + Math.floor(Math.random() * 6)
}

/** 标准骰面：3×3 点位，索引 0–8 */
const PIP_MAP: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

function DieFace({
  value,
  rolling,
  delay = 0,
}: {
  value: number
  rolling?: boolean
  delay?: number
}) {
  const [face, setFace] = useState(value)
  const timerRef = useRef(0)

  useEffect(() => {
    if (!rolling) {
      setFace(value)
      return
    }
    const tick = () => {
      setFace(rollDie())
      timerRef.current = window.setTimeout(tick, 70 + Math.random() * 40)
    }
    timerRef.current = window.setTimeout(tick, delay)
    return () => window.clearTimeout(timerRef.current)
  }, [rolling, value, delay])

  const pips = PIP_MAP[face] ?? []

  return (
    <div
      className={`game-die ${rolling ? 'is-rolling' : 'is-settle'}`}
      style={rolling ? { animationDelay: `${delay}ms` } : undefined}
      aria-label={rolling ? '骰子滚动中' : `点数 ${value}`}
    >
      <div className="game-die-face">
        {Array.from({ length: 9 }, (_, i) => (
          <span
            key={i}
            className={`game-die-pip ${pips.includes(i) ? 'is-on' : ''}`}
          />
        ))}
      </div>
    </div>
  )
}

type CoinSide = '正' | '反'

let coinUid = 0

function CoinMetal({ uid }: { uid: string }) {
  const body = `${uid}-body`
  const sheen = `${uid}-sheen`
  return (
    <>
      <defs>
        {/* 整面同一正黄金，不再内外两层造成环带色差 */}
        <radialGradient id={body} cx="32%" cy="26%" r="78%">
          <stop offset="0%" stopColor="#fff8d4" />
          <stop offset="28%" stopColor="#ffe56e" />
          <stop offset="55%" stopColor="#f0cc38" />
          <stop offset="78%" stopColor="#d4b028" />
          <stop offset="100%" stopColor="#b89820" />
        </radialGradient>
        <radialGradient id={sheen} cx="28%" cy="22%" r="55%">
          <stop offset="0%" stopColor="#fffef0" stopOpacity="0.5" />
          <stop offset="55%" stopColor="#fffef0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="49.2" fill={`url(#${body})`} />
      {/* 齿边：同色浅刻，不用深棕描边 */}
      <circle
        cx="50"
        cy="50"
        r="47.6"
        fill="none"
        stroke="#c8a820"
        strokeOpacity="0.35"
        strokeWidth="2"
        strokeDasharray="0.7 1.15"
      />
      <circle cx="50" cy="50" r="45.8" fill="none" stroke="#fff6c0" strokeOpacity="0.35" strokeWidth="0.7" />
      <circle
        cx="50"
        cy="50"
        r="39.5"
        fill="none"
        stroke="#e8c830"
        strokeOpacity="0.28"
        strokeWidth="0.65"
        strokeDasharray="0.4 1.5"
      />
      <circle cx="50" cy="50" r="49.2" fill={`url(#${sheen})`} />
    </>
  )
}

const COIN_FONT = "Georgia, 'Times New Roman', 'Songti SC', serif"

/** 正面：浮雕叠在亮金面上（不用 multiply，避免中间发黑） */
function CoinHeads({ uid, owner }: { uid: string; owner: NoteAbout }) {
  const clip = `${uid}-clip`
  const fade = `${uid}-fade`
  const lift = `${uid}-lift`
  const ring = `${uid}-ring`
  const mask = `${uid}-mask`
  const ink = '#8a7020'
  return (
    <svg className="game-coin-art" viewBox="0 0 100 100" aria-hidden="true">
      <CoinMetal uid={`${uid}-h`} />
      <defs>
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="35" />
        </clipPath>
        {/* 边缘完全淡出到透明，露出底下同一块金面 */}
        <radialGradient id={fade} cx="50%" cy="40%" r="58%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="38%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="68%" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <mask id={mask}>
          <rect width="100" height="100" fill="#000" />
          <circle cx="50" cy="50" r="35" fill={`url(#${fade})`} />
        </mask>
        {/* 提亮头像，贴近币面黄金亮度 */}
        <filter id={lift} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="linear" slope="1.35" intercept="0.12" />
            <feFuncG type="linear" slope="1.28" intercept="0.1" />
            <feFuncB type="linear" slope="0.85" intercept="0.02" />
          </feComponentTransfer>
        </filter>
        <path id={ring} d="M14.5,50 a35.5,35.5 0 1,1 71,0 a35.5,35.5 0 1,1 -71,0" fill="none" />
      </defs>
      <image
        href={coinPortraitUrl(owner)}
        x="15"
        y="12"
        width="70"
        height="70"
        clipPath={`url(#${clip})`}
        mask={`url(#${mask})`}
        filter={`url(#${lift})`}
        preserveAspectRatio="xMidYMid slice"
        opacity="0.72"
      />
      <text
        fill={ink}
        fillOpacity="0.62"
        fontSize="3.5"
        letterSpacing="2.6"
        fontFamily={COIN_FONT}
        fontWeight="700"
      >
        <textPath href={`#${ring}`} startOffset="0%">
          · BETWEEN US · BETWEEN US · BETWEEN US ·
        </textPath>
      </text>
    </svg>
  )
}

/** 反面：名字 + 环绕 between us */
function CoinTails({ uid, owner }: { uid: string; owner: NoteAbout }) {
  const ring = `${uid}-ring`
  const ink = '#6a5818'
  const name = coinTailsName(owner)
  return (
    <svg className="game-coin-art" viewBox="0 0 100 100" aria-hidden="true">
      <CoinMetal uid={`${uid}-t`} />
      <defs>
        <path id={ring} d="M14.5,50 a35.5,35.5 0 1,1 71,0 a35.5,35.5 0 1,1 -71,0" fill="none" />
      </defs>
      <text
        fill={ink}
        fillOpacity="0.72"
        fontSize="3.6"
        letterSpacing="2.6"
        fontFamily={COIN_FONT}
        fontWeight="700"
      >
        <textPath href={`#${ring}`} startOffset="0%">
          · BETWEEN US · BETWEEN US · BETWEEN US ·
        </textPath>
      </text>
      <circle
        cx="50"
        cy="50"
        r="26"
        fill="none"
        stroke={ink}
        strokeOpacity="0.28"
        strokeWidth="0.75"
      />
      <text
        x="50"
        y="54"
        textAnchor="middle"
        fill={ink}
        fillOpacity="0.88"
        fontSize={owner === 'me' ? 12.5 : 14}
        fontFamily={COIN_FONT}
        fontWeight="700"
        letterSpacing={owner === 'me' ? 0.6 : 1.2}
      >
        {name}
      </text>
    </svg>
  )
}

function CoinFace({
  side,
  flipping,
  delay = 0,
  owner,
}: {
  side: CoinSide
  flipping: boolean
  delay?: number
  owner: NoteAbout
}) {
  const uid = useRef(`c${++coinUid}`).current
  const [flash, setFlash] = useState<CoinSide>(side)

  useEffect(() => {
    if (!flipping) {
      setFlash(side)
      return
    }
    const id = window.setInterval(() => {
      setFlash((s) => (s === '正' ? '反' : '正'))
    }, 85)
    return () => window.clearInterval(id)
  }, [flipping, side])

  const shown = flipping ? flash : side
  const name = coinTailsName(owner)

  return (
    <div
      className={`game-coin ${flipping ? 'is-flipping' : 'is-settle'}`}
      style={flipping ? { animationDelay: `${delay}ms` } : undefined}
      aria-label={
        flipping
          ? '硬币翻转中'
          : shown === '正'
            ? `正面 · ${aboutLabel(owner)}头像`
            : `反面 · ${name}`
      }
    >
      <div className="game-coin-disk">
        {shown === '正' ? (
          <CoinHeads uid={`${uid}-a`} owner={owner} />
        ) : (
          <CoinTails uid={`${uid}-b`} owner={owner} />
        )}
      </div>
    </div>
  )
}

type Kind = 'dice' | 'coin'

const DICE_COUNTS = [1, 2, 3, 4, 5, 6] as const
const COIN_COUNTS = [1, 2, 3] as const

function rollCoin(): CoinSide {
  return Math.random() < 0.5 ? '正' : '反'
}

type Phase = 'lobby' | 'table'

/** 房主定的玩法：骰子/硬币、几个 */
type SetupMsg = {
  type: 'setup'
  kind: Kind
  count: number
  seq: number
}

/** 只描述掷出这一方自己的结果。不公开时不带点数。 */
type FaceMsg = {
  rulesSeq: number
  seq: number
  open: boolean
  rolled: boolean
  values: number[]
  coins: CoinSide[]
  spinning?: boolean
}

type Msg =
  | (FaceMsg & { type: 'hello'; who: NoteAbout; kind: Kind; count: number; rulesSeq: number })
  | (FaceMsg & { type: 'mine' })
  | SetupMsg

function isKind(value: unknown): value is Kind {
  return value === 'dice' || value === 'coin'
}

function isCoinSide(value: unknown): value is CoinSide {
  return value === '正' || value === '反'
}

function legalCount(kind: Kind, count: unknown): count is number {
  const allowed = kind === 'coin' ? COIN_COUNTS : DICE_COUNTS
  return typeof count === 'number' && (allowed as readonly number[]).includes(count)
}

function isSetup(raw: unknown): raw is SetupMsg {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) return false
  const msg = raw as SetupMsg
  if (msg.type !== 'setup') return false
  return (
    isKind(msg.kind) &&
    legalCount(msg.kind, msg.count) &&
    Number.isInteger(msg.seq) &&
    msg.seq >= 0 &&
    msg.seq < 10000
  )
}

function isFace(raw: unknown): raw is FaceMsg {
  if (!raw || typeof raw !== 'object') return false
  const msg = raw as FaceMsg
  if (!Number.isInteger(msg.rulesSeq) || msg.rulesSeq < 0 || msg.rulesSeq > 9999) return false
  if (!Number.isInteger(msg.seq) || msg.seq < 0 || msg.seq > 9999) return false
  if (typeof msg.open !== 'boolean' || typeof msg.rolled !== 'boolean') return false
  if (!Array.isArray(msg.values) || !Array.isArray(msg.coins)) return false
  if (!msg.open || !msg.rolled) {
    return msg.values.length === 0 && msg.coins.length === 0
  }
  const n = msg.values.length || msg.coins.length
  if (n < 1 || n > 6) return false
  if (msg.values.length > 0) {
    return (
      msg.coins.length === 0 &&
      msg.values.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 6)
    )
  }
  return msg.coins.every(isCoinSide)
}

function HiddenDie() {
  return (
    <div className="game-die" aria-label="未公开">
      <span className="font-display text-[1.7rem] text-[var(--ink-soft)]">?</span>
    </div>
  )
}

function HiddenCoin() {
  return (
    <div className="game-coin" aria-label="未公开">
      <div
        className="game-coin-disk grid place-items-center font-display text-3xl text-[#6a5818]"
        style={{
          background:
            'radial-gradient(circle at 32% 26%, #fff8d4 0%, #ffe56e 28%, #f0cc38 55%, #d4b028 78%, #b89820 100%)',
        }}
      >
        ?
      </div>
    </div>
  )
}

function ThrowStage({
  kind,
  count,
  values,
  coins,
  spinning,
  rolled,
  concealed,
  spinKey,
  emptyText,
  owner,
}: {
  kind: Kind
  count: number
  values: number[]
  coins: CoinSide[]
  spinning: boolean
  rolled: boolean
  concealed: boolean
  spinKey: number
  emptyText: string
  owner: NoteAbout
}) {
  if (spinning && concealed) {
    return (
      <div className="mt-3 flex min-h-28 flex-wrap items-center justify-center gap-4">
        {Array.from({ length: count }, (_, i) =>
          kind === 'coin' ? (
            <CoinFace
              key={`${spinKey}-coin-${i}`}
              side="正"
              flipping
              delay={i * 60}
              owner={owner}
            />
          ) : (
            <DieFace key={`${spinKey}-die-${i}`} value={1} rolling delay={i * 70} />
          ),
        )}
      </div>
    )
  }

  if (concealed && rolled) {
    return (
      <div className="mt-3 flex min-h-28 flex-wrap items-center justify-center gap-4">
        {Array.from({ length: count }, (_, i) =>
          kind === 'coin' ? <HiddenCoin key={i} /> : <HiddenDie key={i} />,
        )}
      </div>
    )
  }

  const empty = kind === 'dice' ? values.length === 0 : coins.length === 0
  if (empty && !spinning) {
    return (
      <div className="mt-3 flex min-h-28 items-center justify-center">
        <p className="text-sm text-[var(--ink-soft)]">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="mt-3 flex min-h-28 flex-wrap items-center justify-center gap-4">
      {kind === 'coin'
        ? coins.map((side, i) => (
            <CoinFace
              key={`coin-${spinKey}-${i}-${spinning ? 'flip' : 'done'}`}
              side={side}
              flipping={spinning}
              delay={i * 60}
              owner={owner}
            />
          ))
        : values.map((value, i) => (
            <DieFace
              key={`die-${spinKey}-${i}-${spinning ? 'roll' : 'done'}`}
              value={value}
              rolling={spinning}
              delay={i * 70}
            />
          ))}
    </div>
  )
}

export function DicePage() {
  const navigate = useNavigate()
  const room = usePeerRoom()
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>(room.who)
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(room.peerWho)
  const [code, setCode] = useState(room.code)
  const [isHost, setIsHost] = useState(room.isHost)
  const [busy, setBusy] = useState(false)
  const [bootStatus, setBootStatus] = useState('正在进入…')
  const [error, setError] = useState('')
  const [kind, setKind] = useState<Kind>('dice')
  const [count, setCount] = useState(1)
  const [values, setValues] = useState<number[]>([])
  const [coins, setCoins] = useState<CoinSide[]>([])
  const [spinning, setSpinning] = useState(false)
  const [open, setOpen] = useState(true)
  const [rolled, setRolled] = useState(false)
  const [mySeq, setMySeq] = useState(0)
  const [peerValues, setPeerValues] = useState<number[]>([])
  const [peerCoins, setPeerCoins] = useState<CoinSide[]>([])
  const [peerSpinning, setPeerSpinning] = useState(false)
  const [peerOpen, setPeerOpen] = useState(true)
  const [peerRolled, setPeerRolled] = useState(false)
  const [peerSeq, setPeerSeq] = useState(-1)

  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  const peerWhoRef = useRef<NoteAbout | null>(null)
  const codeRef = useRef('')
  const isHostRef = useRef(false)
  const kindRef = useRef<Kind>('dice')
  const countRef = useRef(1)
  const rulesSeqRef = useRef(0)
  const valuesRef = useRef<number[]>([])
  const coinsRef = useRef<CoinSide[]>([])
  const spinningRef = useRef(false)
  const openRef = useRef(true)
  const rolledRef = useRef(false)
  const mySeqRef = useRef(0)
  const peerSeqRef = useRef(-1)
  const myCastId = useRef(0)
  const peerCastId = useRef(0)
  const leavingHubRef = useRef(false)

  whoRef.current = who
  peerWhoRef.current = peerWho
  codeRef.current = code
  isHostRef.current = isHost

  const counts = kind === 'dice' ? DICE_COUNTS : COIN_COUNTS
  const canEditRules = isHost && !spinning

  useConfirmLeaveGame(phase !== 'lobby')
  // Provider 持有 Peer；本页卸载不销毁
  usePeerSessionGuard(sessionRef, () => true)

  // 换游戏时 hello 可能落在对方 QUIET 窗口，对上之前持续打招呼
  useEffect(() => {
    if (phase === 'lobby' || peerWho) return
    hello()
    const id = window.setInterval(() => {
      if (!peerWhoRef.current) hello()
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase, peerWho])

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!code, () => {
    if (!codeRef.current) return null
    return {
      game: 'dice',
      code: codeRef.current,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
    }
  })

  const resumeSavedRef = useRef<{
    code: string
    role: 'host' | 'joiner'
    who: NoteAbout
  } | null>(null)

  useGamePeerBoot(
    'dice',
    () => {
      adoptLiveRoom()
    },
    (saved) => {
      resumeSavedRef.current = { code: saved.code, role: saved.role, who: saved.who }
      setBusy(true)
      setError('')
      whoRef.current = saved.who
      setWho(saved.who)
      if (saved.role === 'host') void create(saved.code)
      else void join(saved.code)
    },
  )

  function adoptLiveRoom() {
    const session = room.session
    if (!session) return
    room.bindHandlers(navHandlers(diceHandlers()))
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

  function clearMine() {
    myCastId.current += 1
    spinningRef.current = false
    setSpinning(false)
    valuesRef.current = []
    coinsRef.current = []
    rolledRef.current = false
    setValues([])
    setCoins([])
    setRolled(false)
  }

  function clearPeerBoard() {
    peerCastId.current += 1
    peerSeqRef.current = -1
    setPeerSeq(-1)
    setPeerSpinning(false)
    setPeerOpen(true)
    setPeerRolled(false)
    setPeerValues([])
    setPeerCoins([])
  }

  function mineFace(spinningNow: boolean): FaceMsg {
    const visible = openRef.current
    return {
      rulesSeq: rulesSeqRef.current,
      seq: mySeqRef.current,
      open: visible,
      rolled: rolledRef.current,
      values: visible ? valuesRef.current : [],
      coins: visible ? coinsRef.current : [],
      spinning: spinningNow,
    }
  }

  function publishSetup() {
    if (!sessionRef.current?.isHost) return
    sessionRef.current.sendReliable({
      type: 'setup',
      kind: kindRef.current,
      count: countRef.current,
      seq: rulesSeqRef.current,
    } satisfies SetupMsg)
  }

  function hello() {
    const face = mineFace(spinningRef.current)
    sessionRef.current?.sendReliable({
      type: 'hello',
      who: whoRef.current,
      kind: kindRef.current,
      count: countRef.current,
      ...face,
    } satisfies Msg)
    if (sessionRef.current?.isHost) publishSetup()
  }

  function publishMine(spinningNow: boolean) {
    sessionRef.current?.sendReliable({
      type: 'mine',
      ...mineFace(spinningNow),
    } satisfies Msg)
  }

  function notePeer(next: NoteAbout) {
    peerWhoRef.current = next
    setPeerWho(next)
  }

  function applyRules(nextKind: Kind, nextCount: number, seq: number) {
    if (seq < rulesSeqRef.current) return false
    if (seq === rulesSeqRef.current) {
      // 同序号只补齐显示
      if (kindRef.current !== nextKind || countRef.current !== nextCount) {
        kindRef.current = nextKind
        countRef.current = nextCount
        setKind(nextKind)
        setCount(nextCount)
      }
      return false
    }
    rulesSeqRef.current = seq
    kindRef.current = nextKind
    countRef.current = nextCount
    setKind(nextKind)
    setCount(nextCount)
    clearMine()
    clearPeerBoard()
    mySeqRef.current += 1
    setMySeq(mySeqRef.current)
    return true
  }

  function applyPeer(msg: FaceMsg) {
    if (msg.rulesSeq !== rulesSeqRef.current) return
    if (msg.seq <= peerSeqRef.current) return
    peerSeqRef.current = msg.seq
    setPeerSeq(msg.seq)
    setPeerOpen(msg.open)
    setPeerRolled(msg.rolled)
    setPeerValues(msg.open ? msg.values : [])
    setPeerCoins(msg.open ? msg.coins : [])
    const id = ++peerCastId.current
    if (!msg.spinning || !msg.rolled) {
      setPeerSpinning(false)
      return
    }
    setPeerSpinning(true)
    window.setTimeout(() => {
      if (id !== peerCastId.current) return
      setPeerSpinning(false)
    }, 900)
  }

  function onData(raw: unknown) {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return
    const msg = raw as Msg
    if (msg.type === 'setup') {
      if (sessionRef.current?.isHost || !isSetup(msg)) return
      const changed = applyRules(msg.kind, msg.count, msg.seq)
      if (changed) publishMine(false)
      return
    }
    if (msg.type === 'hello') {
      if (msg.who !== 'her' && msg.who !== 'me') return
      const firstSight = peerWhoRef.current !== msg.who
      notePeer(msg.who)
      setError('')
      let needHello = firstSight
      if (!sessionRef.current?.isHost) {
        const mine = otherAbout(msg.who)
        if (whoRef.current !== mine) {
          whoRef.current = mine
          setWho(mine)
          needHello = true
        }
        if (isKind(msg.kind) && legalCount(msg.kind, msg.count)) {
          if (applyRules(msg.kind, msg.count, msg.rulesSeq)) needHello = true
        }
      }
      if (isFace(msg)) applyPeer(msg)
      if (needHello) hello()
      return
    }
    if (msg.type === 'mine') {
      if (!isFace(msg)) return
      applyPeer(msg)
    }
  }

  function onRoomOpen() {
    setError('')
    hello()
  }

  function diceHandlers() {
    return {
      onData,
      onOpen: onRoomOpen,
      onWake: () => hello(),
      onDisconnect: () => {
        // ICE 抖动不丢掉对方身份，否则一人进桌一人仍在大厅时会误显示「等对方」
        setError('连接不稳，正在重连…')
      },
      onClose: () => {
        peerWhoRef.current = null
        setPeerWho(null)
        room.setPeerWho(null)
        setError('对方断开了')
      },
    }
  }

  function navHandlers(handlers: RoomHandlers) {
    return withHubNav(handlers, {
      navigate,
      hereGame: 'dice',
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

  function bindDiceSession(
    session: RoomSession,
    role: 'host' | 'joiner',
    kickOpen: boolean,
  ) {
    sessionRef.current = session
    room.attachSession(session, { who: whoRef.current })
    room.bindHandlers(navHandlers(diceHandlers()))
    isHostRef.current = role === 'host'
    setIsHost(role === 'host')
    codeRef.current = session.code
    setCode(session.code)
    setPhase('table')
    savePeerRoom({
      game: 'dice',
      code: session.code,
      role,
      who: whoRef.current,
    })
    if (kickOpen && session.conn?.open) onRoomOpen()
  }

  function friendlyPeerError(err: unknown, fallback: string) {
    const msg = err instanceof Error ? err.message : String(err ?? '')
    if (/unavailable-id|is taken|already in use/i.test(msg)) {
      return '房间号还被旧连接占着，点重新进房再试一次'
    }
    return msg || fallback
  }

  async function create(existingCode?: string) {
    setBusy(true)
    setError('')
    setBootStatus('正在接回已有连接…')
    try {
      const handlers = navHandlers(diceHandlers())
      if (existingCode) {
        const live = await adoptParkedSession(existingCode, true, handlers)
        if (live) {
          bindDiceSession(live, 'host', true)
          return
        }
      }
      // 暂存没接到才会走到这：先释放可能仍占号的旧 Peer，再向信令占房号
      setBootStatus('没接到旧连接，正在重新占房号…')
      sessionRef.current?.destroy()
      sessionRef.current = null
      if (existingCode) await releaseParkedRoom(existingCode)
      const session = await createPeerRoom(
        handlers,
        existingCode ? { code: existingCode } : undefined,
      )
      bindDiceSession(session, 'host', false)
    } catch (e) {
      setError(friendlyPeerError(e, '开房失败'))
      setPhase('lobby')
    } finally {
      setBusy(false)
    }
  }

  async function join(room: string) {
    setBusy(true)
    setError('')
    setBootStatus('正在接回已有连接…')
    try {
      const handlers = navHandlers(diceHandlers())
      const live = await adoptParkedSession(room, false, handlers)
      if (live) {
        bindDiceSession(live, 'joiner', true)
        return
      }
      setBootStatus('没接到旧连接，正在连对方…')
      sessionRef.current?.destroy()
      sessionRef.current = null
      await releaseParkedRoom(room)
      const session = await joinPeerRoom(room, handlers)
      bindDiceSession(session, 'joiner', false)
    } catch (e) {
      setError(friendlyPeerError(e, '加入失败'))
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

  function commitRules(nextKind: Kind, nextCount: number) {
    if (!isHostRef.current || spinningRef.current) return
    if (nextKind === kindRef.current && nextCount === countRef.current) return
    rulesSeqRef.current += 1
    kindRef.current = nextKind
    countRef.current = nextCount
    setKind(nextKind)
    setCount(nextCount)
    clearMine()
    clearPeerBoard()
    mySeqRef.current += 1
    setMySeq(mySeqRef.current)
    if (!peerWhoRef.current) return
    publishSetup()
    publishMine(false)
  }

  function switchKind(next: Kind) {
    const nextCount =
      next === 'coin' ? Math.min(countRef.current, COIN_COUNTS[COIN_COUNTS.length - 1]) : countRef.current
    commitRules(next, nextCount)
  }

  function switchCount(next: number) {
    commitRules(kindRef.current, next)
  }

  function chooseOpen(next: boolean) {
    if (spinningRef.current || next === openRef.current) return
    openRef.current = next
    setOpen(next)
    mySeqRef.current += 1
    setMySeq(mySeqRef.current)
    publishMine(false)
  }

  function cast() {
    if (!peerWhoRef.current || spinningRef.current) return
    const nextKind = kindRef.current
    const nextCount = countRef.current
    const nextValues = nextKind === 'dice' ? Array.from({ length: nextCount }, rollDie) : []
    const nextCoins = nextKind === 'coin' ? Array.from({ length: nextCount }, rollCoin) : []
    valuesRef.current = nextValues
    coinsRef.current = nextCoins
    rolledRef.current = true
    setValues(nextValues)
    setCoins(nextCoins)
    setRolled(true)
    mySeqRef.current += 1
    setMySeq(mySeqRef.current)
    const id = ++myCastId.current
    spinningRef.current = true
    setSpinning(true)
    publishMine(true)
    window.setTimeout(() => {
      if (id !== myCastId.current) return
      spinningRef.current = false
      setSpinning(false)
    }, 900)
  }

  async function leaveRoom() {
    if (leavingHubRef.current) return
    leavingHubRef.current = true
    const roomCode = codeRef.current || room.code
    if (!roomCode) {
      clearPeerRoom('dice')
      setPhase('lobby')
      return
    }
    setBusy(true)
    await leaveGameToHub({
      sendReliable: (data, times) => room.sendReliable(data, times),
      code: roomCode,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
      navigate,
      onLocalLeave: () => {
        sessionRef.current = null
        peerWhoRef.current = null
        setPeerWho(null)
      },
    })
  }

  return (
    <GameShell
      title="掷骰子"
      blurb="房主选骰子或硬币、几个。两边各掷各的；不公开时对方看不到点数，但重摇仍有动画。"
    >
      {phase === 'lobby' ? (
        <EnterRoomGate
          busy={busy}
          status={busy ? bootStatus : undefined}
          error={busy ? undefined : error}
          onRetry={resumeSavedRef.current ? () => retryResume() : undefined}
        />
      ) : (
        <>
          {!peerWho ? (
            <RoomBanner
              code={code}
              detail={isHost ? `你是${aboutLabel(who)} · 等对方` : `你是${aboutLabel(who)}`}
            />
          ) : null}

          <div className="dice-toolbar">
            <div className="dice-seg" role="tablist" aria-label="类型">
              {(
                [
                  ['dice', '骰子'],
                  ['coin', '硬币'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={kind === key}
                  className={kind === key ? 'is-on' : ''}
                  disabled={!canEditRules}
                  onClick={() => switchKind(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="dice-seg dice-seg-count" role="tablist" aria-label="数量">
              {counts.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="tab"
                  aria-selected={count === n}
                  className={count === n ? 'is-on' : ''}
                  disabled={!canEditRules}
                  onClick={() => switchCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>

            <div className="dice-seg" role="tablist" aria-label="是否公开">
              {(
                [
                  [true, '公开'],
                  [false, '不公开'],
                ] as const
              ).map(([flag, label]) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={open === flag}
                  className={open === flag ? 'is-on' : ''}
                  disabled={spinning}
                  onClick={() => chooseOpen(flag)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!isHost && peerWho ? (
            <p className="-mt-1 text-xs text-[var(--ink-soft)]">玩法由房主选择，你这边跟着</p>
          ) : null}

          <div className="mt-6">
            <p className="text-center text-xs tracking-[0.14em] text-[var(--ink-soft)]">
              你 · {aboutLabel(who)}
              {open ? '' : ' · 未公开'}
            </p>
            <ThrowStage
              kind={kind}
              count={count}
              values={values}
              coins={coins}
              spinning={spinning}
              rolled={rolled}
              concealed={false}
              spinKey={mySeq}
              emptyText={peerWho ? '点下面开始' : '等对方进房'}
              owner={who}
            />
          </div>

          <button
            type="button"
            onClick={cast}
            disabled={!peerWho || spinning}
            className="game-btn game-btn-leaf mt-4 w-full"
          >
            {!peerWho ? '等对方进房' : kind === 'coin' ? '抛一次' : '掷一次'}
          </button>

          <div className="mt-8 border-t border-[color-mix(in_srgb,var(--ink)_8%,transparent)] pt-5">
            <p className="text-center text-xs tracking-[0.14em] text-[var(--ink-soft)]">
              {peerWho ? aboutLabel(peerWho) : '对方'}
              {peerRolled && !peerOpen ? ' · 未公开' : ''}
            </p>
            <ThrowStage
              kind={kind}
              count={count}
              values={peerValues}
              coins={peerCoins}
              spinning={peerSpinning}
              rolled={peerRolled}
              concealed={peerRolled && !peerOpen}
              spinKey={peerSeq}
              emptyText={peerWho ? '还没掷' : '等对方进房'}
              owner={peerWho ?? otherAbout(who)}
            />
          </div>

          {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

          <button
            type="button"
            className="game-btn game-btn-ghost mt-3 w-full"
            onClick={leaveRoom}
          >
            回大厅
          </button>
        </>
      )}
    </GameShell>
  )
}
