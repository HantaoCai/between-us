import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BackToHubButton } from './BackToHubButton'

const TIP_EDGE_GAP = 12
const TIP_MAX_HEIGHT_CAP = 24 * 16

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
  /** 气泡相对问号的对齐：end=右对齐（默认），start=左对齐，center=相对问号居中 */
  placement?: 'start' | 'end' | 'center'
}) {
  const [open, setOpen] = useState(false)
  const [above, setAbove] = useState(false)
  const closeTimer = useRef(0)
  const rootRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)
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

  /** 上下按剩余空间，左右夹进游戏壳/视口，避免溢出手机屏 */
  useLayoutEffect(() => {
    if (!open) return
    const root = rootRef.current
    const pop = popRef.current
    if (!root || !pop) return

    function place() {
      const anchor = root!.getBoundingClientRect()
      const spaceBelow = window.innerHeight - anchor.bottom - TIP_EDGE_GAP
      const spaceAbove = anchor.top - TIP_EDGE_GAP
      const preferAbove = spaceBelow < 180 && spaceAbove > spaceBelow
      setAbove(preferAbove)

      const available = Math.max(96, preferAbove ? spaceAbove : spaceBelow)
      const maxH = Math.min(available, window.innerHeight * 0.7, TIP_MAX_HEIGHT_CAP)
      pop!.style.maxHeight = `${Math.floor(maxH)}px`

      const shell = root!.closest('.game-shell')
      const bounds = shell?.getBoundingClientRect()
      const viewLeft = Math.max(TIP_EDGE_GAP, (bounds?.left ?? 0) + TIP_EDGE_GAP)
      const viewRight = Math.min(
        window.innerWidth - TIP_EDGE_GAP,
        (bounds?.right ?? window.innerWidth) - TIP_EDGE_GAP,
      )
      const maxW = Math.max(160, viewRight - viewLeft)
      pop!.style.width = `${Math.min(19.5 * 16, maxW)}px`
      pop!.style.setProperty('--tip-shift-x', '0px')

      const popRect = pop!.getBoundingClientRect()
      let shiftX = 0
      if (popRect.left < viewLeft) shiftX = viewLeft - popRect.left
      else if (popRect.right > viewRight) shiftX = viewRight - popRect.right
      pop!.style.setProperty('--tip-shift-x', `${Math.round(shiftX)}px`)
    }

    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      pop.style.maxHeight = ''
      pop.style.width = ''
      pop.style.removeProperty('--tip-shift-x')
    }
  }, [open, placement, above])

  if (!body) return null

  return (
    <span
      ref={rootRef}
      className={[
        'game-tip',
        `game-tip-${placement}`,
        above ? 'game-tip-above' : '',
        open ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
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
      <span ref={popRef} className="game-tip-pop" role="tooltip">
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
