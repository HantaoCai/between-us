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

const WHEEL_COLORS = [
  '#3f7a61',
  '#c4a574',
  '#5a8f78',
  '#d4b896',
  '#2f5d4a',
  '#b8956a',
  '#6fa08a',
  '#e0c9a4',
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

  const wheelStyle = useMemo(() => {
    if (wheelItems.length === 0) {
      return { background: 'color-mix(in srgb, var(--leaf) 18%, white)' }
    }
    const stops = wheelItems.map((_, i) => {
      const color = WHEEL_COLORS[i % WHEEL_COLORS.length]
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
        ? `已选 ${picked.length} 个，点「入池开转」再转`
        : '先勾选今晚想吃的，至少 2 个再转'
      : mode === 'eliminate'
        ? finished
          ? '淘汰完了，今晚就它。'
          : `还剩 ${live.length} 个，转一下踢掉一个`
        : mode === 'veto'
          ? `转出结果后可否决（剩 ${vetoesLeft} 次）`
          : '指针停哪，今晚吃哪'

  return (
    <section className="eats-page mx-auto w-full max-w-2xl px-5 pb-20 pt-4 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.18em] text-[var(--ink-soft)]">TONIGHT</p>
          <h1 className="font-display mt-1 text-4xl text-[var(--ink)] sm:text-5xl">
            吃什么
          </h1>
          <p className="mt-3 max-w-md text-[var(--ink-soft)]">
            先把今晚想吃的勾进池子，再转；淘汰赛最解气，否决权留给真正吃不下的那口。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/wishlist" className="text-sm text-[var(--leaf)]">
            愿望清单
          </Link>
          <EditModeToggle />
        </div>
      </div>

      <div className="eats-modes mt-6" role="tablist" aria-label="玩法">
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

      <div className="eats-pool mt-6">
        <div className="eats-pool-head">
          <p className="eats-pool-label">
            {phase === 'pick' ? '① 筛选入池' : '今晚池子'}
          </p>
          {phase === 'pick' ? (
            <div className="eats-pool-actions">
              <button type="button" onClick={pickAll} disabled={spinning}>
                全选
              </button>
              <button type="button" onClick={pickNone} disabled={spinning}>
                清空
              </button>
            </div>
          ) : (
            <button type="button" onClick={backToPick} disabled={spinning}>
              改池
            </button>
          )}
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

      <div
        className={`eats-stage mt-8 ${spinning ? 'is-spinning' : ''} ${celebrate ? 'is-win' : ''} ${phase === 'pick' ? 'is-pick' : ''}`}
      >
        <div className="eats-pointer" aria-hidden />
        <div className="eats-ring" aria-hidden />
        <div className="eats-wheel" style={wheelStyle}>
          {wheelItems.map((label, i) => {
            const angle = i * slice + slice / 2
            return (
              <span
                key={`${label}-${i}`}
                className="eats-label"
                style={{
                  transform: `rotate(${angle}deg) translateY(calc(-1 * min(32vw, 6.6rem)))`,
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

      <p className="eats-hint mt-5 text-center text-sm text-[var(--ink-soft)]">{hint}</p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
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
        <button
          type="button"
          className="game-btn game-btn-ghost"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? '收起菜单' : '改菜单'}
        </button>
      </div>

      {result ? (
        <div className={`eats-result-board ${celebrate ? 'is-final' : ''}`} role="status">
          <p className="eats-result-eyebrow">
            {finished || (mode !== 'eliminate' && !result.startsWith('淘汰'))
              ? '今晚就它'
              : '本轮'}
          </p>
          <p className="eats-result-title font-hand">
            {finished || mode !== 'eliminate' ? result.replace(/^淘汰：/, '') : result}
          </p>
        </div>
      ) : null}

      {eliminated.length > 0 ? (
        <div className="eats-elim mt-6">
          <p className="eats-elim-label">已出局</p>
          <ul>
            {eliminated.map((name, i) => (
              <li key={`${name}-${i}`}>{name}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {editing ? (
        <div className="eats-edit mt-8 space-y-4">
          <form onSubmit={onAdd} className="flex flex-wrap gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="加一道想吃的"
              maxLength={24}
              className="wish-input min-w-[12rem] flex-1"
              disabled={busy}
            />
            <button
              type="submit"
              className="game-btn game-btn-leaf"
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
          <p className="text-xs text-[var(--ink-soft)]">
            {enabled
              ? '已解锁：菜单会同步给对方。'
              : available
                ? '未解锁时只改本机；点「编辑」可同步。'
                : '改动保存在本机。'}
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
    </section>
  )
}
