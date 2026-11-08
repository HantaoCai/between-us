import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BackToHubButton } from './BackToHubButton'

/** 问号标记：点击展开规则说明（桌面也可悬停） */
export function RuleTip({
  text,
  children,
  label = '规则说明',
  placement = 'end',
}: {
  text?: string
  children?: ReactNode
  label?: string
  /** 气泡相对问号的对齐：end=右对齐（默认），start=左对齐 */
  placement?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef(0)
  const rootRef = useRef<HTMLSpanElement>(null)
  const body = children ?? text

  function clearTimers() {
    window.clearTimeout(closeTimer.current)
  }

  function show() {
    clearTimers()
    setOpen(true)
  }

  function hideSoon() {
    clearTimers()
    closeTimer.current = window.setTimeout(() => setOpen(false), 140)
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

  if (!body) return null

  return (
    <span
      ref={rootRef}
      className={`game-tip game-tip-${placement} ${open ? 'is-open' : ''}`}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
    >
      <button
        type="button"
        className="game-tip-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        ?
      </button>
      <span className="game-tip-pop" role="tooltip">
        {body}
      </span>
    </span>
  )
}

export function GameShell({
  title,
  blurb,
  tip,
  compact,
  dense,
  keepTip,
  onBackToHub,
  backBusy,
  children,
}: {
  title: string
  blurb?: string
  /** 结构化规则气泡；优先于 blurb */
  tip?: ReactNode
  /** 对局中再收一层，隐藏标题与说明 */
  compact?: boolean
  /** 一屏打满：收紧边距，少滚动 */
  dense?: boolean
  /** compact 时仍保留标题旁问号 */
  keepTip?: boolean
  /** 传入后左下角固定小「回大厅」（只自己回，不弹框） */
  onBackToHub?: () => void
  backBusy?: boolean
  children: React.ReactNode
}) {
  const tipNode = tip ? <RuleTip label={`${title}规则`}>{tip}</RuleTip> : blurb ? <RuleTip text={blurb} /> : null
  const showTop = !compact || (keepTip && !!tipNode)

  return (
    <section
      className={[
        'game-shell mx-auto w-full max-w-lg px-4 sm:px-6',
        dense ? 'pt-0 game-shell-dense' : 'pt-0.5',
        dense
          ? 'pb-[max(0.6rem,env(safe-area-inset-bottom))]'
          : 'pb-[max(1.25rem,env(safe-area-inset-bottom))]',
      ].join(' ')}
    >
      {showTop ? (
        <div className="game-shell-top flex min-h-8 items-center justify-between gap-3">
          {compact ? <span className="font-display text-base text-[var(--ink)]">{title}</span> : (
            <h1 className="font-display text-[1.45rem] leading-none text-[var(--ink)] sm:text-3xl">
              {title}
            </h1>
          )}
          {tipNode}
        </div>
      ) : null}

      <div
        className={[
          'game-shell-body',
          compact ? (dense ? 'mt-0.5' : 'mt-2') : 'mt-3',
        ].join(' ')}
      >
        {children}
      </div>
      {onBackToHub ? (
        <BackToHubButton busy={backBusy} onConfirm={onBackToHub} />
      ) : null}
    </section>
  )
}
