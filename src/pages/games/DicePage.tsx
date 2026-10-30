import { useEffect, useRef, useState } from 'react'
import { GameShell } from '../../components/GameShell'

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
        <radialGradient id={m} cx="30%" cy="24%" r="76%">
          <stop offset="0%" stopColor="#f8ecd0" />
          <stop offset="28%" stopColor="#e0b86a" />
          <stop offset="55%" stopColor="#c4923c" />
          <stop offset="78%" stopColor="#8a5e24" />
          <stop offset="100%" stopColor="#4a3012" />
        </radialGradient>
        <linearGradient id={e} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#f5e6bc" />
          <stop offset="45%" stopColor="#c49840" />
          <stop offset="100%" stopColor="#523416" />
        </linearGradient>
        <radialGradient id={s} cx="28%" cy="22%" r="55%">
          <stop offset="0%" stopColor="#fffaf0" stopOpacity="0.42" />
          <stop offset="55%" stopColor="#fffaf0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="49.2" fill={`url(#${e})`} />
      <circle cx="50" cy="50" r="45.5" fill={`url(#${m})`} />
      <circle
        cx="50"
        cy="50"
        r="47.3"
        fill="none"
        stroke="#2a1a08"
        strokeOpacity="0.48"
        strokeWidth="2.1"
        strokeDasharray="0.65 1.1"
      />
      <circle cx="50" cy="50" r="43.6" fill="none" stroke="#f2e0a8" strokeOpacity="0.3" strokeWidth="0.75" />
      <circle cx="50" cy="50" r="41.4" fill="none" stroke="#5c3c12" strokeOpacity="0.48" strokeWidth="0.95" />
      <circle
        cx="50"
        cy="50"
        r="39.2"
        fill="none"
        stroke="#efe0b0"
        strokeOpacity="0.32"
        strokeWidth="0.7"
        strokeDasharray="0.4 1.4"
      />
      <circle cx="50" cy="50" r="45.5" fill={`url(#${s})`} />
    </>
  )
}

const COIN_FONT = "var(--font-display), 'Songti SC', Georgia, serif"

/** 正面：佳佳侧脸 + 环字 */
function CoinHeads({ uid }: { uid: string }) {
  const top = `${uid}-top`
  const bot = `${uid}-bot`
  const ink = '#3a280e'
  return (
    <svg className="game-coin-art" viewBox="0 0 100 100" aria-hidden="true">
      <CoinMetal uid={`${uid}-h`} />
      <defs>
        <path id={top} d="M22,48 a28,28 0 1,1 56,0" fill="none" />
        <path id={bot} d="M76,54 a26,26 0 1,1 -52,0" fill="none" />
      </defs>
      <text
        fill={ink}
        fillOpacity="0.8"
        fontSize="5.2"
        letterSpacing="3"
        fontFamily={COIN_FONT}
        fontWeight="700"
      >
        <textPath href={`#${top}`} startOffset="50%" textAnchor="middle">
          佳 佳
        </textPath>
      </text>
      {/* 柔顺长发侧脸 */}
      <g fill={ink}>
        <path
          d="M38 30c-7 3-11 11-10 19 1 7 5 13 12 15-2-5-1-10 1-14-6-2-9-8-8-14 1-3 3-5 5-6z"
          fillOpacity="0.78"
        />
        <path
          d="M43 29c9-2 16 3 17 12 1 6-2 11-6 14 3 1 5 4 4 8-1 5-6 9-13 9-4 0-7-2-9-4 2-3 3-8 2-12 5-2 8-7 8-13 0-5-1-10-3-14z"
          fillOpacity="0.84"
        />
        <path d="M56 43c2.2 1 3.4 3 3.2 5.2L56 52c1.2-2.2 1.4-5.2 0-9z" fillOpacity="0.68" />
        <path d="M52 54c2.4 1.2 3.2 2.4 2.2 3.4h-5c1.2-1.2 1.6-2.4 2.8-3.4z" fillOpacity="0.62" />
        <path
          d="M41 64c5 2 12 3 17 0.5 0.8 3.2-1.5 6.5-6 7.5-7 1.2-14-2-16-6.5 2-0.5 3.5-1.2 5-1.5z"
          fillOpacity="0.72"
        />
        <path
          d="M35 70c7 4.5 18 5.5 26 1.5-2.5 4.5-9 8-15.5 8-8 0-14-3.5-16-8 2 0 4-0.8 5.5-1.5z"
          fillOpacity="0.5"
        />
        {/* 垂发 */}
        <path
          d="M36 48c-3 6-3 14-1 20 2-5 4-11 5-17-1-1-3-2-4-3z"
          fillOpacity="0.55"
        />
      </g>
      <path
        d="M41 34c-2.5 5-2 11 0.5 16M46 32c-1.5 6 0 12 2.5 17"
        fill="none"
        stroke="#f2e0a8"
        strokeOpacity="0.3"
        strokeWidth="0.85"
        strokeLinecap="round"
      />
      {/* 发上小叶饰 */}
      <path
        d="M50 27c3-1.5 5 0.5 5.5 3-2.5-0.5-4.5-0.2-5.5-1.2-0.5-0.5-0.5-1.2 0-1.8z"
        fill={ink}
        fillOpacity="0.7"
      />
      <circle cx="55.2" cy="29.2" r="0.9" fill="#f2e0a8" fillOpacity="0.65" />
      <text
        fill={ink}
        fillOpacity="0.68"
        fontSize="4"
        letterSpacing="1.5"
        fontFamily={COIN_FONT}
      >
        <textPath href={`#${bot}`} startOffset="50%" textAnchor="middle">
          JIA JIA
        </textPath>
      </text>
    </svg>
  )
}

/** 反面：双叶纹章 + Between Us（无人像） */
function CoinTails({ uid }: { uid: string }) {
  const top = `${uid}-top`
  const bot = `${uid}-bot`
  const ink = '#3a280e'
  return (
    <svg className="game-coin-art" viewBox="0 0 100 100" aria-hidden="true">
      <CoinMetal uid={`${uid}-t`} />
      <defs>
        <path id={top} d="M22,48 a28,28 0 1,1 56,0" fill="none" />
        <path id={bot} d="M76,56 a26,26 0 1,1 -52,0" fill="none" />
      </defs>
      <text
        fill={ink}
        fillOpacity="0.78"
        fontSize="4.2"
        letterSpacing="1.4"
        fontFamily={COIN_FONT}
        fontWeight="700"
      >
        <textPath href={`#${top}`} startOffset="50%" textAnchor="middle">
          BETWEEN US
        </textPath>
      </text>
      <circle cx="50" cy="50" r="21" fill="none" stroke={ink} strokeOpacity="0.32" strokeWidth="0.85" />
      {/* 交叠双叶 */}
      <path
        d="M50 36c-9 5-14 14-12 24 9-4 14-12 15-21-1-1-2-2-3-3z"
        fill={ink}
        fillOpacity="0.74"
      />
      <path
        d="M50 36c9 5 14 14 12 24-9-4-14-12-15-21 1-1 2-2 3-3z"
        fill={ink}
        fillOpacity="0.58"
      />
      <path
        d="M50 37v26"
        stroke="#f2e0a8"
        strokeOpacity="0.38"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M44 46c3 2 5 5 6 8M56 46c-3 2-5 5-6 8"
        fill="none"
        stroke="#f2e0a8"
        strokeOpacity="0.28"
        strokeWidth="0.7"
        strokeLinecap="round"
      />
      {/* 中心小圆点 */}
      <circle cx="50" cy="48" r="1.6" fill="#f2e0a8" fillOpacity="0.55" />
      <text
        x="50"
        y="78"
        textAnchor="middle"
        fill={ink}
        fillOpacity="0.82"
        fontSize="7"
        fontFamily={COIN_FONT}
        fontWeight="700"
        letterSpacing="2"
      >
        永远
      </text>
      <text
        fill={ink}
        fillOpacity="0.58"
        fontSize="3.6"
        letterSpacing="1.2"
        fontFamily={COIN_FONT}
      >
        <textPath href={`#${bot}`} startOffset="50%" textAnchor="middle">
          晗涛 · 佳佳
        </textPath>
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
        flipping ? '硬币翻转中' : shown === '正' ? '正面 · 佳佳' : '反面 · Between Us'
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
