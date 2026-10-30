import { useEffect, useRef, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { aboutLabel, type NoteAbout } from '../../lib/notes'

type Phase = 'idle' | 'wait' | 'go' | 'early' | 'result'

export function ReactionPage() {
  const [who, setWho] = useState<NoteAbout>('her')
  const [phase, setPhase] = useState<Phase>('idle')
  const [ms, setMs] = useState<number | null>(null)
  const [best, setBest] = useState<{ her: number | null; me: number | null }>({
    her: null,
    me: null,
  })
  const timerRef = useRef(0)
  const startRef = useRef(0)

  useEffect(() => {
    return () => window.clearTimeout(timerRef.current)
  }, [])

  function arm() {
    window.clearTimeout(timerRef.current)
    setPhase('wait')
    setMs(null)
    const delay = 1200 + Math.random() * 2800
    timerRef.current = window.setTimeout(() => {
      startRef.current = performance.now()
      setPhase('go')
    }, delay)
  }

  function tap() {
    if (phase === 'wait') {
      window.clearTimeout(timerRef.current)
      setPhase('early')
      return
    }
    if (phase !== 'go') return
    const elapsed = Math.round(performance.now() - startRef.current)
    setMs(elapsed)
    setPhase('result')
    setBest((prev) => {
      const cur = prev[who]
      return { ...prev, [who]: cur == null ? elapsed : Math.min(cur, elapsed) }
    })
  }

  return (
    <GameShell title="反应力">
      <div className="wall-filter mb-4">
        {(
          [
            ['her', aboutLabel('her')],
            ['me', aboutLabel('me')],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={who === key ? 'is-on' : ''}
            onClick={() => setWho(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 text-center text-sm">
        <div className="rounded-2xl bg-white/60 px-3 py-2">
          <p className="text-xs text-[var(--ink-soft)]">{aboutLabel('her')} 最佳</p>
          <p className="font-display text-2xl text-[var(--leaf)]">
            {best.her == null ? '—' : `${best.her}ms`}
          </p>
        </div>
        <div className="rounded-2xl bg-white/60 px-3 py-2">
          <p className="text-xs text-[var(--ink-soft)]">{aboutLabel('me')} 最佳</p>
          <p className="font-display text-2xl text-[var(--cork-ink)]">
            {best.me == null ? '—' : `${best.me}ms`}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          if (phase === 'wait' || phase === 'go') tap()
          else arm()
        }}
        className={[
          'mt-6 flex min-h-48 w-full items-center justify-center text-lg transition',
          phase === 'go'
            ? 'bg-[var(--leaf)] text-[var(--foam)]'
            : phase === 'wait'
              ? 'bg-[#c45c4a] text-white'
              : 'bg-white/70 text-[var(--ink-soft)]',
        ].join(' ')}
      >
        {phase === 'idle' && '点这里开始'}
        {phase === 'wait' && '等绿…'}
        {phase === 'go' && '点！'}
        {phase === 'early' && '太早了，再来'}
        {phase === 'result' && `${aboutLabel(who)} ${ms}ms · 再来一次`}
      </button>
    </GameShell>
  )
}
