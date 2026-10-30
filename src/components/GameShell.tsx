import { useEffect, useRef, useState } from 'react'

function RuleTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const holdTimer = useRef(0)
  const closeTimer = useRef(0)
  const rootRef = useRef<HTMLSpanElement>(null)

  function clearTimers() {
    window.clearTimeout(holdTimer.current)
    window.clearTimeout(closeTimer.current)
  }

  function show() {
    clearTimers()
    setOpen(true)
  }

  function hideSoon() {
    window.clearTimeout(holdTimer.current)
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(false), 120)
  }

  function hideNow() {
    clearTimers()
    setOpen(false)
  }

  useEffect(() => () => clearTimers(), [])

  useEffect(() => {
    if (!open) return
    function onDoc(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) hideNow()
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])

  return (
    <span
      ref={rootRef}
      className={`game-tip ${open ? 'is-open' : ''}`}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
    >
      <button
        type="button"
        className="game-tip-btn"
        aria-label="规则说明"
        aria-expanded={open}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return
          clearTimers()
          holdTimer.current = window.setTimeout(() => setOpen(true), 280)
        }}
        onPointerUp={(e) => {
          if (e.pointerType === 'mouse') return
          window.clearTimeout(holdTimer.current)
        }}
        onPointerCancel={hideNow}
        onClick={() => {
          if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            setOpen((v) => !v)
          }
        }}
      >
        ?
      </button>
      <span className="game-tip-pop" role="tooltip">
        {text}
      </span>
    </span>
  )
}

export function GameShell({
  title,
  blurb,
  compact,
  children,
}: {
  title: string
  blurb?: string
  /** 对局中再收一层，隐藏标题与说明 */
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="game-shell mx-auto w-full max-w-lg px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-1 sm:px-6">
      {compact ? null : (
        <div className="game-shell-top flex min-h-9 items-start justify-between gap-3">
          <h1 className="font-display text-[1.65rem] leading-none text-[var(--ink)] sm:text-3xl">
            {title}
          </h1>
          {blurb ? <RuleTip text={blurb} /> : null}
        </div>
      )}

      <div className={compact ? 'mt-2' : 'mt-4'}>{children}</div>
    </section>
  )
}
