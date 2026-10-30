import { useEffect, useRef, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { assetUrl } from '../../lib/assetUrl'

function jiajiaPortraitUrl() {
  return assetUrl('games/jiajia-coin-heads.jpg')
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
  const m = `${uid}-m`
  const e = `${uid}-e`
  const s = `${uid}-s`
  return (
    <>
      <defs>
        {/* 冷亮银：高光白、中调钢灰、边缘深铅 */}
        <radialGradient id={m} cx="28%" cy="22%" r="78%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="18%" stopColor="#eef2f6" />
          <stop offset="42%" stopColor="#c5ccd6" />
          <stop offset="68%" stopColor="#8a93a0" />
          <stop offset="100%" stopColor="#3a4048" />
        </radialGradient>
        <linearGradient id={e} x1="0.05" y1="0" x2="0.95" y2="1">
          <stop offset="0%" stopColor="#f7f9fc" />
          <stop offset="35%" stopColor="#a8b0bc" />
          <stop offset="100%" stopColor="#2e343c" />
        </linearGradient>
        <radialGradient id={s} cx="26%" cy="20%" r="52%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="49.2" fill={`url(#${e})`} />
      <circle cx="50" cy="50" r="45.5" fill={`url(#${m})`} />
      <circle
        cx="50"
        cy="50"
        r="47.3"
        fill="none"
        stroke="#1a1e24"
        strokeOpacity="0.55"
        strokeWidth="2.1"
        strokeDasharray="0.65 1.1"
      />
      <circle cx="50" cy="50" r="43.6" fill="none" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="0.75" />
      <circle cx="50" cy="50" r="41.4" fill="none" stroke="#4a525c" strokeOpacity="0.55" strokeWidth="0.95" />
      <circle
        cx="50"
        cy="50"
        r="39.2"
        fill="none"
        stroke="#d8dee6"
        strokeOpacity="0.45"
        strokeWidth="0.7"
        strokeDasharray="0.4 1.4"
      />
      <circle cx="50" cy="50" r="45.5" fill={`url(#${s})`} />
    </>
  )
}

const COIN_FONT = "Georgia, 'Times New Roman', 'Songti SC', serif"

/** 正面：动漫头像嵌金边 */
function CoinHeads({ uid }: { uid: string }) {
  const clip = `${uid}-clip`
  const ring = `${uid}-ring`
  const ink = '#2a3038'
  return (
    <svg className="game-coin-art" viewBox="0 0 100 100" aria-hidden="true">
      <CoinMetal uid={`${uid}-h`} />
      <defs>
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="34.5" />
        </clipPath>
        <path id={ring} d="M16,50 a34,34 0 1,1 68,0 a34,34 0 1,1 -68,0" fill="none" />
      </defs>
      <image
        href={jiajiaPortraitUrl()}
        x="15.5"
        y="15.5"
        width="69"
        height="69"
        clipPath={`url(#${clip})`}
        preserveAspectRatio="xMidYMid slice"
      />
      <circle
        cx="50"
        cy="50"
        r="34.5"
        fill="none"
        stroke="#3a424c"
        strokeOpacity="0.5"
        strokeWidth="1.1"
      />
      <circle
        cx="50"
        cy="50"
        r="36.2"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.35"
        strokeWidth="0.7"
      />
      <text
        fill={ink}
        fillOpacity="0.75"
        fontSize="3.6"
        letterSpacing="2.8"
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

/** 反面：面额一百元 + 环绕 between us */
function CoinTails({ uid }: { uid: string }) {
  const ring = `${uid}-ring`
  const ink = '#2a3038'
  const display = "var(--font-display), 'Songti SC', serif"
  return (
    <svg className="game-coin-art" viewBox="0 0 100 100" aria-hidden="true">
      <CoinMetal uid={`${uid}-t`} />
      <defs>
        <path id={ring} d="M16,50 a34,34 0 1,1 68,0 a34,34 0 1,1 -68,0" fill="none" />
      </defs>
      <text
        fill={ink}
        fillOpacity="0.8"
        fontSize="3.8"
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
        strokeOpacity="0.3"
        strokeWidth="0.85"
      />
      <text
        x="50"
        y="46"
        textAnchor="middle"
        fill={ink}
        fillOpacity="0.55"
        fontSize="5"
        fontFamily={COIN_FONT}
        fontWeight="700"
        letterSpacing="1"
      >
        ¥ 100
      </text>
      <text
        x="50"
        y="60"
        textAnchor="middle"
        fill={ink}
        fillOpacity="0.92"
        fontSize="11"
        fontFamily={display}
        fontWeight="700"
        letterSpacing="2"
      >
        一百元
      </text>
    </svg>
  )
}

function CoinFace({
  side,
  flipping,
  delay = 0,
}: {
  side: CoinSide
  flipping: boolean
  delay?: number
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

  return (
    <div
      className={`game-coin ${flipping ? 'is-flipping' : 'is-settle'}`}
      style={flipping ? { animationDelay: `${delay}ms` } : undefined}
      aria-label={
        flipping ? '硬币翻转中' : shown === '正' ? '正面 · 佳佳头像' : '反面 · 一百元'
      }
    >
      <div className="game-coin-disk">
        {shown === '正' ? (
          <CoinHeads uid={`${uid}-a`} />
        ) : (
          <CoinTails uid={`${uid}-b`} />
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

export function DicePage() {
  const [kind, setKind] = useState<Kind>('dice')
  const [count, setCount] = useState(1)
  const [values, setValues] = useState<number[]>([])
  const [coins, setCoins] = useState<CoinSide[]>([])
  const [spinning, setSpinning] = useState(false)
  const castId = useRef(0)

  const counts = kind === 'dice' ? DICE_COUNTS : COIN_COUNTS

  function resetResult() {
    castId.current += 1
    setValues([])
    setCoins([])
    setSpinning(false)
  }

  function switchKind(next: Kind) {
    if (next === kind) return
    resetResult()
    setKind(next)
    setCount((n) =>
      next === 'coin' ? Math.min(n, COIN_COUNTS[COIN_COUNTS.length - 1]) : n,
    )
  }

  function switchCount(next: number) {
    if (next === count) return
    resetResult()
    setCount(next)
  }

  function cast() {
    if (spinning) return
    const id = ++castId.current
    setSpinning(true)

    if (kind === 'coin') {
      setCoins(Array.from({ length: count }, rollCoin))
      setValues([])
    } else {
      setValues(Array.from({ length: count }, rollDie))
      setCoins([])
    }

    window.setTimeout(() => {
      if (id !== castId.current) return
      setSpinning(false)
    }, 900)
  }

  const showPlaceholder =
    !spinning &&
    ((kind === 'dice' && values.length === 0) ||
      (kind === 'coin' && coins.length === 0))

  return (
    <GameShell title="掷骰子">
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
              onClick={() => switchCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex min-h-28 flex-wrap items-center justify-center gap-4">
        {showPlaceholder ? (
          <p className="text-sm text-[var(--ink-soft)]">点下面开始</p>
        ) : kind === 'coin' ? (
          coins.map((side, i) => (
            <CoinFace
              key={`coin-${i}`}
              side={side}
              flipping={spinning}
              delay={i * 60}
            />
          ))
        ) : (
          values.map((v, i) => (
            <DieFace
              key={`die-${i}-${spinning ? 'roll' : 'done'}`}
              value={v}
              rolling={spinning}
              delay={i * 70}
            />
          ))
        )}
      </div>

      <button
        type="button"
        onClick={cast}
        disabled={spinning}
        className="game-btn game-btn-leaf mt-6 w-full"
      >
        {kind === 'coin' ? '抛一次' : '掷一次'}
      </button>
    </GameShell>
  )
}
