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
const VETO_MAX = 2

type Mode = 'once' | 'eliminate' | 'veto'
type Phase = 'pick' | 'spin'

const MODE_LABEL: Record<Mode, string> = {
  once: '一转定音',
  eliminate: '淘汰赛',
  veto: '否决权',
}

/** 跟站点 leaf / foam / mist 同系 */
const WHEEL_SLICES = [
  { bg: '#2f5d4a', ink: '#f0f4f1' },
  { bg: '#e8efe9', ink: '#1c2420' },
  { bg: '#3f7a61', ink: '#f0f4f1' },
  { bg: '#f0f4f1', ink: '#1c2420' },
  { bg: '#264a3c', ink: '#f0f4f1' },
  { bg: '#dfe8e2', ink: '#1c2420' },
  { bg: '#4a8a6e', ink: '#f0f4f1' },
  { bg: '#edf3ef', ink: '#1c2420' },
]

export function EatsPage() {
  const { available, enabled, ready } = useEditMode()
  const [pool, setPool] = useState<string[]>(() => readLocalEats() ?? seedEats)
  const [picked, setPicked] = useState<string[]>(() => readLocalEats() ?? seedEats)
  const [live, setLive] = useState<string[]>([])
  const [phase, setPhase] = useState<Phase>('pick')
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<Mode>('eliminate')
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [result, setResult] = useState<string | null>(null)
  const [eliminated, setEliminated] = useState<string[]>([])
  const [vetoesLeft, setVetoesLeft] = useState(VETO_MAX)
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
        if (next.length > 0) {
          setPool(next)
          setPicked(next)
          writeLocalEats(next)
          setPhase('pick')
          setLive([])
          setEliminated([])
          setResult(null)
          setVetoesLeft(VETO_MAX)
        }
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

  const wheelItems = phase === 'spin' ? live : picked
  const slice = wheelItems.length > 0 ? 360 / wheelItems.length : 360
  const finished =
    phase === 'spin' &&
    mode === 'eliminate' &&
    live.length === 1 &&
    eliminated.length > 0
  const canEnterSpin = picked.length >= 2
  const showFinal =
    Boolean(result) &&
    (finished || (mode !== 'eliminate' && !result!.startsWith('淘汰')))

  const wheelStyle = useMemo(() => {
    if (wheelItems.length === 0) {
      return {
        background:
          'radial-gradient(circle at 40% 35%, #f0f4f1, color-mix(in srgb, var(--leaf) 18%, #e8efe9))',
      }
    }
    const stops = wheelItems.map((_, i) => {
      const color = WHEEL_SLICES[i % WHEEL_SLICES.length]!.bg
      const start = (i * slice).toFixed(2)
      const end = ((i + 1) * slice).toFixed(2)
      return `${color} ${start}deg ${end}deg`
    })
    return {
      background: `conic-gradient(from -90deg, ${stops.join(', ')})`,
      transform: `rotate(${rotation}deg)`,
      transition: spinning
        ? `transform ${SPIN_MS}ms cubic-bezier(0.08, 0.82, 0.08, 1)`
        : 'none',
    }
  }, [wheelItems, rotation, slice, spinning])

  async function persistPool(next: string[]) {
    const cleaned = normalizeEats(next)
    setPool(cleaned)
    writeLocalEats(cleaned)
    setPicked((prev) => {
      const kept = prev.filter((item) => cleaned.includes(item))
      const added = cleaned.filter((item) => !prev.includes(item) && !pool.includes(item))
      return normalizeEats([...kept, ...added])
    })
    if (!spinning) {
      setPhase('pick')
      setLive([])
      setEliminated([])
      setResult(null)
      setVetoesLeft(VETO_MAX)
      setCelebrate(false)
    }
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
    setLive(picked)
    setEliminated([])
    setResult(null)
    setVetoesLeft(VETO_MAX)
    setCelebrate(false)
    setRotation(0)
    setPhase('spin')
  }

  function spin() {
    if (phase !== 'spin' || spinning || live.length < 1 || finished) return
    if (mode === 'once' && live.length < 2) return
    if (mode === 'eliminate' && live.length < 2) return

    setResult(null)
    setSpinning(true)
    const current = liveRef.current
    const currentSlice = current.length > 0 ? 360 / current.length : 360
    const index = pickEatIndex(current.length)
    const target =
      360 * (4 + Math.floor(Math.random() * 3)) +
      (360 - (index * currentSlice + currentSlice / 2))
    setRotation((prev) => {
      const base = prev % 360
      return prev + (target - base)
    })
    window.clearTimeout(spinTimer.current)
    spinTimer.current = window.setTimeout(() => {
      const round = liveRef.current
      const pickedName = round[index] ?? round[0]
      setSpinning(false)
      if (!pickedName) return

      if (mode === 'eliminate') {
        const nextLive = round.filter((_, i) => i !== index)
        setEliminated((prev) => [pickedName, ...prev])
        if (nextLive.length === 1) {
          setLive(nextLive)
          burst(nextLive[0]!)
          return
        }
        setLive(nextLive)
        setResult(`淘汰：${pickedName}`)
        return
      }

      burst(pickedName)
    }, SPIN_MS)
  }

  function veto() {
    if (spinning || phase !== 'spin' || mode !== 'veto' || !result || vetoesLeft <= 0)
      return
    setVetoesLeft((n) => n - 1)
    setResult(null)
    setCelebrate(false)
  }

  function backToPick() {
    if (spinning) return
    setPhase('pick')
    setLive([])
    setEliminated([])
    setResult(null)
    setVetoesLeft(VETO_MAX)
    setCelebrate(false)
    setRotation(0)
  }

  function resetRound() {
    if (spinning || phase !== 'spin') return
    setLive(picked)
    setEliminated([])
    setResult(null)
    setVetoesLeft(VETO_MAX)
    setCelebrate(false)
    setRotation(0)
  }

  function changeMode(next: Mode) {
    if (spinning) return
    setMode(next)
    if (phase === 'spin') {
      setLive(picked)
      setEliminated([])
      setResult(null)
      setVetoesLeft(VETO_MAX)
      setCelebrate(false)
      setRotation(0)
    }
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

  function pickAll() {
    if (spinning || phase === 'spin') return
    setPicked(pool)
  }

  function pickNone() {
    if (spinning || phase === 'spin') return
    setPicked([])
  }

  const hint =
    phase === 'pick'
      ? canEnterSpin
        ? `已选 ${picked.length} 道，可以开转`
        : '先点选今晚想吃的，至少两道'
      : mode === 'eliminate'
        ? finished
          ? '定了。今晚就它。'
          : `还剩 ${live.length} 道，转一下踢掉一个`
        : mode === 'veto'
          ? `转出后可否决（剩 ${vetoesLeft} 次）`
          : '指针停哪，今晚吃哪'

  const resultText = result
    ? finished || mode !== 'eliminate'
      ? result.replace(/^淘汰：/, '')
      : result
    : null

  return (
    <section className={`eats-page ${phase === 'spin' ? 'is-spin-phase' : 'is-pick-phase'}`}>
      <header className="eats-hero">
        <div className="eats-hero-copy">
          <p className="eats-kicker">TONIGHT</p>
          <h1 className="font-display eats-title">吃什么</h1>
          <p className="eats-lead">先勾进池子，再转一圈定今晚。</p>
        </div>
        <div className="eats-hero-tools">
          <Link to="/wishlist" className="eats-text-link">
            愿望清单
          </Link>
          <EditModeToggle />
        </div>
      </header>

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

      <div
        className={[
          'eats-stage',
          spinning ? 'is-spinning' : '',
          celebrate ? 'is-win' : '',
          phase === 'pick' ? 'is-pick' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="eats-ring" aria-hidden />
        <div className="eats-pointer" aria-hidden />
        <div className="eats-wheel" style={wheelStyle}>
          {wheelItems.map((label, i) => {
            const angle = i * slice + slice / 2
            const ink = WHEEL_SLICES[i % WHEEL_SLICES.length]!.ink
            return (
              <span
                key={`${label}-${i}`}
                className="eats-label"
                style={{
                  transform: `rotate(${angle}deg) translateY(calc(-1 * min(35vw, 7.1rem)))`,
                  color: ink,
                }}
              >
                <span style={{ transform: `rotate(${-angle}deg)` }}>{label}</span>
              </span>
            )
          })}
        </div>
        {phase === 'spin' ? (
          <button
            type="button"
            className="eats-hub"
            disabled={spinning || live.length < 1 || finished}
            onClick={spin}
          >
            {spinning ? '…' : finished ? '定' : '转'}
          </button>
        ) : (
          <button
            type="button"
            className="eats-hub"
            disabled={!canEnterSpin}
            onClick={enterSpin}
          >
            开
          </button>
        )}
        {celebrate ? (
          <div className="eats-sparks" aria-hidden>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} style={{ ['--i' as string]: i }} />
            ))}
          </div>
        ) : null}
      </div>

      <p className="eats-hint">{hint}</p>

      <div className="eats-actions">
        {phase === 'pick' ? (
          <button
            type="button"
            className="game-btn game-btn-leaf"
            disabled={!canEnterSpin}
            onClick={enterSpin}
          >
            入池开转
          </button>
        ) : (
          <>
            <button
              type="button"
              className="game-btn game-btn-leaf"
              disabled={spinning || live.length < 1 || finished}
              onClick={spin}
            >
              {spinning
                ? '转着…'
                : finished
                  ? '已定下来'
                  : mode === 'eliminate'
                    ? '淘汰一个'
                    : '转！'}
            </button>
            {mode === 'veto' && result && !result.startsWith('淘汰') && vetoesLeft > 0 ? (
              <button
                type="button"
                className="game-btn game-btn-ghost"
                disabled={spinning}
                onClick={veto}
              >
                不行，换（{vetoesLeft}）
              </button>
            ) : null}
            <button
              type="button"
              className="game-btn game-btn-ghost"
              disabled={spinning}
              onClick={resetRound}
            >
              重来
            </button>
            <button
              type="button"
              className="game-btn game-btn-ghost"
              disabled={spinning}
              onClick={backToPick}
            >
              改池
            </button>
          </>
        )}
      </div>

      {resultText ? (
        <div className={`eats-result ${showFinal ? 'is-final' : ''}`} role="status">
          <p className="eats-result-eyebrow">{showFinal ? '今晚就它' : '本轮'}</p>
          <p className="font-hand eats-result-title">{resultText}</p>
        </div>
      ) : null}

      <div className="eats-pool">
        <div className="eats-pool-head">
          <p className="eats-pool-label">{phase === 'pick' ? '筛选入池' : '今晚池子'}</p>
          <div className="eats-pool-actions">
            {phase === 'pick' ? (
              <>
                <button type="button" onClick={pickAll} disabled={spinning}>
                  全选
                </button>
                <button type="button" onClick={pickNone} disabled={spinning}>
                  清空
                </button>
              </>
            ) : (
              <button type="button" onClick={backToPick} disabled={spinning}>
                改池
              </button>
            )}
            <button type="button" onClick={() => setEditing((v) => !v)}>
              {editing ? '收起菜单' : '改菜单'}
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

      {eliminated.length > 0 ? (
        <div className="eats-elim">
          <p className="eats-elim-label">已出局</p>
          <ul>
            {eliminated.map((name, i) => (
              <li key={`${name}-${i}`}>{name}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {editing ? (
        <div className="eats-edit">
          <form onSubmit={onAdd} className="eats-edit-form">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="加一道想吃的"
              maxLength={24}
              className="eats-edit-input"
              disabled={busy}
            />
            <button
              type="submit"
              className="game-btn game-btn-leaf game-btn-sm"
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
              ? '已解锁：菜单会同步给对方。'
              : available
                ? '未解锁时只改本机；点「编辑」可同步。'
                : '改动保存在本机。'}
          </p>
        </div>
      ) : null}

      {error ? <p className="eats-error">{error}</p> : null}
    </section>
  )
}
