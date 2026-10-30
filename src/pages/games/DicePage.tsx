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

/** 正面：头像叠在同一金面上，不做深色内环 */
function CoinHeads({ uid }: { uid: string }) {
  const clip = `${uid}-clip`
  const fade = `${uid}-fade`
  const ring = `${uid}-ring`
  const mask = `${uid}-mask`
  const ink = '#6a5818'
  return (
    <svg className="game-coin-art" viewBox="0 0 100 100" aria-hidden="true">
      <CoinMetal uid={`${uid}-h`} />
      <defs>
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="36" />
        </clipPath>
        <radialGradient id={fade} cx="50%" cy="42%" r="62%">
          <stop offset="42%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="72%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <mask id={mask}>
          <circle cx="50" cy="50" r="36" fill={`url(#${fade})`} />
        </mask>
        <path id={ring} d="M14.5,50 a35.5,35.5 0 1,1 71,0 a35.5,35.5 0 1,1 -71,0" fill="none" />
      </defs>
      <image
        href={jiajiaPortraitUrl()}
        x="14"
        y="12"
        width="72"
        height="72"
        clipPath={`url(#${clip})`}
        mask={`url(#${mask})`}
        preserveAspectRatio="xMidYMid slice"
        opacity="0.88"
        style={{ mixBlendMode: 'multiply' }}
      />
      <text
        fill={ink}
        fillOpacity="0.7"
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

/** 反面：JiaJia + 环绕 between us */
function CoinTails({ uid }: { uid: string }) {
  const ring = `${uid}-ring`
  const ink = '#6a5818'
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
        fontSize="14"
        fontFamily={COIN_FONT}
        fontWeight="700"
        letterSpacing="1.2"
      >
        JiaJia
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
        flipping ? '硬币翻转中' : shown === '正' ? '正面 · 佳佳头像' : '反面 · JiaJia'
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
