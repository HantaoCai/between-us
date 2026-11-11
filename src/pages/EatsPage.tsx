import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { EditModeToggle } from '../components/EditModeToggle'
import { fetchSharedDoc, saveSharedDoc } from '../lib/editApi'
import { useEditMode } from '../lib/editContext'
import {
  normalizeEats,
  pickEatIndex,
  readLocalEats,
  seedEats,
  writeLocalEats,
} from '../lib/eats'

const SPIN_MS = 3800

type Mode = 'once' | 'eliminate'
type Phase = 'pick' | 'spin'

const MODE_LABEL: Record<Mode, string> = {
  once: '一转定音',
  eliminate: '淘汰赛',
}

/** 暖灰 / 纸色严格交替，淘汰后也不会两块深色粘在一起 */
const WHEEL_SLICES = [
  { bg: '#5c5348', ink: '#f7f4ee' },
  { bg: '#f7f4ee', ink: '#2a2218' },
]

const DEAD_SLICE = { bg: '#d8d2c8', ink: '#9a948a' }

const initialMenu = () => readLocalEats() ?? seedEats

export function EatsPage() {
  const { available, enabled, ready } = useEditMode()
  const [pool, setPool] = useState<string[]>(initialMenu)
  const [picked, setPicked] = useState<string[]>(initialMenu)
  const [live, setLive] = useState<string[]>([])
  /** 本轮转盘盘面（淘汰赛出局后仍留在盘上变灰，避免扇区重排） */
  const [board, setBoard] = useState<string[]>([])
  const [phase, setPhase] = useState<Phase>('pick')
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<Mode>('eliminate')
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [result, setResult] = useState<string | null>(null)
  const [eliminated, setEliminated] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [celebrate, setCelebrate] = useState(false)

  const spinTimer = useRef(0)
  const celebrateTimer = useRef(0)
  const liveRef = useRef(live)
  liveRef.current = live

  useEffect(
    () => () => {
      window.clearTimeout(spinTimer.current)
      window.clearTimeout(celebrateTimer.current)
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!ready || !available) return
      try {
        const raw = await fetchSharedDoc('eats')
        if (cancelled) return
        const next = normalizeEats(raw)
        if (next.length === 0) return
        setPool(next)
        setPicked(next)
        writeLocalEats(next)
        clearRound('pick')
      } catch (e) {
        if (cancelled) return
        if (!(e instanceof Error && e.message === 'cloud-doc-missing')) {
          setError(e instanceof Error ? e.message : '读取失败')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [available, ready])

  const eliminatedSet = useMemo(() => new Set(eliminated), [eliminated])
  const wheelItems =
    phase === 'pick' ? picked : mode === 'eliminate' ? board : live
  const slice = wheelItems.length > 0 ? 360 / wheelItems.length : 360
  const finished =
    phase === 'spin' &&
    mode === 'eliminate' &&
    live.length === 1 &&
    eliminated.length > 0
  const canEnterSpin = picked.length >= 2
  const showFinal =
    Boolean(result) &&
    (finished || (mode !== 'eliminate' && !String(result).startsWith('淘汰')))

  function sliceTone(name: string, index: number) {
    if (mode === 'eliminate' && phase === 'spin' && eliminatedSet.has(name)) {
      return DEAD_SLICE
    }
    return WHEEL_SLICES[index % WHEEL_SLICES.length]!
  }

  const wheelStyle = useMemo(() => {
    if (wheelItems.length === 0) {
      return {
        background:
          'radial-gradient(circle at 40% 35%, #f7f4ee, #ebe4d8)',
      }
    }
    const stops = wheelItems.map((name, i) => {
      const color = sliceTone(name, i).bg
      const start = (i * slice).toFixed(2)
      const end = ((i + 1) * slice).toFixed(2)
      return `${color} ${start}deg ${end}deg`
    })
    return {
      /* 0deg 在正上方，与指针、标签中心角一致，避免字压在分割线上 */
      background: `conic-gradient(from 0deg, ${stops.join(', ')})`,
      transform: `rotate(${rotation}deg)`,
      transition: spinning
        ? `transform ${SPIN_MS}ms cubic-bezier(0.08, 0.82, 0.08, 1)`
        : 'none',
    }
  }, [wheelItems, rotation, slice, spinning, mode, phase, eliminatedSet])

  function clearRound(nextPhase: Phase = phase) {
    setPhase(nextPhase)
    const nextLive = nextPhase === 'spin' ? picked : []
    setLive(nextLive)
    setBoard(nextPhase === 'spin' ? picked : [])
    setEliminated([])
    setResult(null)
    setCelebrate(false)
    setRotation(0)
  }

  async function persistPool(next: string[]) {
    const cleaned = normalizeEats(next)
    setPool(cleaned)
    writeLocalEats(cleaned)
    setPicked((prev) => {
      const kept = prev.filter((item) => cleaned.includes(item))
      const added = cleaned.filter((item) => !prev.includes(item) && !pool.includes(item))
      return normalizeEats([...kept, ...added])
    })
    if (!spinning) clearRound('pick')
    if (!enabled) return
    setBusy(true)
    setError('')
    try {
      await saveSharedDoc('eats', cleaned)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  function burst(name: string) {
    setCelebrate(true)
    window.clearTimeout(celebrateTimer.current)
    celebrateTimer.current = window.setTimeout(() => setCelebrate(false), 1400)
    setResult(name)
  }

  function togglePick(name: string) {
    if (spinning || phase === 'spin') return
    setPicked((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
    )
  }

  function enterSpin() {
    if (spinning || !canEnterSpin) return
    clearRound('spin')
  }

  function spin() {
    if (phase !== 'spin' || spinning || live.length < 1 || finished) return
    if ((mode === 'once' || mode === 'eliminate') && live.length < 2) return

    setResult(null)
    setSpinning(true)

    // 淘汰赛按整盘格位转；只在仍存活的格子里抽
    const display =
      mode === 'eliminate' && board.length > 0 ? board : liveRef.current
    const activeIdx =
      mode === 'eliminate'
        ? display
            .map((name, i) => (eliminatedSet.has(name) ? -1 : i))
            .filter((i) => i >= 0)
        : display.map((_, i) => i)
    const pickSlot = activeIdx[pickEatIndex(activeIdx.length)] ?? 0
    const currentSlice = display.length > 0 ? 360 / display.length : 360
    const target =
      360 * (4 + Math.floor(Math.random() * 3)) +
      (360 - (pickSlot * currentSlice + currentSlice / 2))
    setRotation((prev) => prev + (target - (prev % 360)))

    window.clearTimeout(spinTimer.current)
    spinTimer.current = window.setTimeout(() => {
      const pickedName = display[pickSlot] ?? liveRef.current[0]
      setSpinning(false)
      if (!pickedName) return

      if (mode === 'eliminate') {
        const nextLive = liveRef.current.filter((name) => name !== pickedName)
        setEliminated((prev) => [pickedName, ...prev])
        setLive(nextLive)
        if (nextLive.length === 1) burst(nextLive[0]!)
        else setResult(`淘汰：${pickedName}`)
        return
      }
      burst(pickedName)
    }, SPIN_MS)
  }

  function changeMode(next: Mode) {
    if (spinning) return
    setMode(next)
    if (phase === 'spin') clearRound('spin')
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    const value = draft.trim()
    if (!value || pool.includes(value) || busy) return
    setDraft('')
    await persistPool([...pool, value])
  }

  async function onRemove(name: string) {
    if (busy || spinning || pool.length <= 2) return
    await persistPool(pool.filter((item) => item !== name))
  }

  const hint =
    phase === 'pick'
      ? canEnterSpin
        ? `已选 ${picked.length} 道`
        : '至少选两道'
      : mode === 'eliminate'
        ? finished
          ? '今晚就它'
          : `剩 ${live.length} · 踢一个`
        : '指针停哪吃哪'

  const resultText = result
    ? finished || mode !== 'eliminate'
      ? result.replace(/^淘汰：/, '')
      : result
    : null

  const stageClass = [
    'eats-stage',
    spinning ? 'is-spinning' : '',
    celebrate ? 'is-win' : '',
    phase === 'pick' ? 'is-pick' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className="eats-page">
      <header className="eats-top">
        <div className="eats-top-main">
          <h1 className="font-display eats-title">吃什么</h1>
          <div className="eats-modes wall-filter" role="tablist" aria-label="玩法">
            {(Object.keys(MODE_LABEL) as Mode[]).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={mode === id ? 'is-on' : ''}
                disabled={spinning}
                onClick={() => changeMode(id)}
              >
                {MODE_LABEL[id]}
              </button>
            ))}
          </div>
        </div>
        <div className="eats-top-tools">
          <Link to="/wishlist" className="eats-text-link">
            清单
          </Link>
          <EditModeToggle />
        </div>
      </header>

      <div className={stageClass}>
        <div className="eats-ring" aria-hidden />
        <div className="eats-pointer" aria-hidden />
        <div className="eats-wheel" style={wheelStyle}>
          {wheelItems.map((label, i) => {
            // 扇区中心角：与 conic-gradient from 0deg（正上）对齐
            const angle = i * slice + slice / 2
            const tone = sliceTone(label, i)
            const dead = tone === DEAD_SLICE
            // 下半圈翻转，字仍沿半径落在本格内（不再转正，避免横跨邻格）
            const flip = angle > 90 && angle < 270
            return (
              <span
                key={`${label}-${i}`}
                className={`eats-label${dead ? ' is-dead' : ''}`}
                style={{
                  transform: `rotate(${angle}deg) translateY(calc(-1 * min(22svh, 26vw, 4.8rem)))`,
                }}
              >
                <span
                  className="eats-label-text"
                  style={{
                    color: tone.ink,
                    transform: `translate(-50%, -50%) rotate(${flip ? 180 : 0}deg)`,
                  }}
                >
                  {label}
                </span>
              </span>
            )
          })}
        </div>
        <button
          type="button"
          className="eats-hub"
          disabled={
            phase === 'pick'
              ? !canEnterSpin
              : spinning || live.length < 1 || finished
          }
          onClick={phase === 'pick' ? enterSpin : spin}
        >
          {phase === 'pick' ? '开' : spinning ? '…' : finished ? '定' : '转'}
        </button>
        {celebrate ? (
          <div className="eats-sparks" aria-hidden>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} style={{ ['--i' as string]: i }} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="eats-status" role="status">
        {resultText ? (
          <p className={`font-hand eats-result-line ${showFinal ? 'is-final' : ''}`}>
            {showFinal ? '今晚 · ' : ''}
            {resultText}
          </p>
        ) : (
          <p className="eats-hint">{hint}</p>
        )}
        {eliminated.length > 0 ? (
          <p className="eats-elim-line">出局 {eliminated.join(' · ')}</p>
        ) : null}
      </div>

      <div className="eats-actions">
        {phase === 'pick' ? (
          <button
            type="button"
            className="game-btn game-btn-ink game-btn-sm"
            disabled={!canEnterSpin}
            onClick={enterSpin}
          >
            入池开转
          </button>
        ) : (
          <>
            <button
              type="button"
              className="game-btn game-btn-ink game-btn-sm"
              disabled={spinning || live.length < 1 || finished}
              onClick={spin}
            >
              {spinning ? '转着…' : finished ? '已定' : mode === 'eliminate' ? '淘汰' : '转'}
            </button>
            <button
              type="button"
              className="game-btn game-btn-ghost game-btn-sm"
              disabled={spinning}
              onClick={() => clearRound('spin')}
            >
              重来
            </button>
            <button
              type="button"
              className="game-btn game-btn-ghost game-btn-sm"
              disabled={spinning}
              onClick={() => clearRound('pick')}
            >
              改池
            </button>
          </>
        )}
      </div>

      <div className="eats-pool">
        <div className="eats-pool-head">
          <span className="eats-pool-label">
            {phase === 'pick' ? '筛选入池' : '今晚池子'}
          </span>
          <div className="eats-pool-actions">
            {phase === 'pick' ? (
              <>
                <button type="button" onClick={() => setPicked(pool)} disabled={spinning}>
                  全选
                </button>
                <button type="button" onClick={() => setPicked([])} disabled={spinning}>
                  清空
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => setEditing(true)}>
              改菜单
            </button>
          </div>
        </div>
        <ul className="eats-pool-chips" aria-label="今晚想吃的">
          {pool.map((item) => {
            const on = picked.includes(item)
            return (
              <li key={item}>
                <button
                  type="button"
                  className={on ? 'is-on' : ''}
                  disabled={spinning || phase === 'spin'}
                  aria-pressed={on}
                  onClick={() => togglePick(item)}
                >
                  {item}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {editing ? (
        <div className="eats-sheet" role="dialog" aria-label="改菜单">
          <div className="eats-sheet-card">
            <div className="eats-pool-head">
              <span className="eats-pool-label">改菜单</span>
              <button type="button" onClick={() => setEditing(false)}>
                完成
              </button>
            </div>
            <form onSubmit={onAdd} className="eats-edit-form">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="加一道"
                maxLength={24}
                className="eats-edit-input"
                disabled={busy}
              />
              <button
                type="submit"
                className="game-btn game-btn-ink game-btn-sm"
                disabled={busy || !draft.trim()}
              >
                添加
              </button>
            </form>
            <ul className="eats-options">
              {pool.map((item) => (
                <li key={item}>
                  <span>{item}</span>
                  <button
                    type="button"
                    disabled={busy || spinning || pool.length <= 2}
                    onClick={() => void onRemove(item)}
                  >
                    删
                  </button>
                </li>
              ))}
            </ul>
            <p className="eats-edit-note">
              {enabled
                ? '已解锁：菜单会同步。'
                : available
                  ? '未解锁只改本机。'
                  : '改动保存在本机。'}
            </p>
            {error ? <p className="eats-error">{error}</p> : null}
          </div>
        </div>
      ) : null}

      {error && !editing ? <p className="eats-error">{error}</p> : null}
    </section>
  )
}
