import { differenceInCalendarDays, parseISO } from 'date-fns'
import { useEffect, useState } from 'react'
import { TOGETHER_SINCE } from '../lib/memories'

export function DaysTogether() {
  const [days, setDays] = useState(() =>
    differenceInCalendarDays(new Date(), parseISO(TOGETHER_SINCE)),
  )

  useEffect(() => {
    const id = window.setInterval(() => {
      setDays(differenceInCalendarDays(new Date(), parseISO(TOGETHER_SINCE)))
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="inline-flex flex-col items-start">
      <span className="text-xs tracking-[0.2em] text-[var(--ink-soft)] uppercase">
        在一起
      </span>
      <span className="font-display mt-1 text-5xl text-[var(--leaf)] sm:text-6xl">
        {days}
        <span className="ml-2 text-2xl text-[var(--ink-soft)]">天</span>
      </span>
      <span className="mt-2 text-sm text-[var(--ink-soft)]">自 {TOGETHER_SINCE}</span>
    </div>
  )
}
