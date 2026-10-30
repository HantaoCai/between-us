import { differenceInCalendarDays, parseISO } from 'date-fns'
import { useEffect, useState } from 'react'
import { TOGETHER_LABEL, TOGETHER_SINCE } from '../lib/memories'

export function DaysTogether() {
  const calcDays = () =>
    differenceInCalendarDays(new Date(), parseISO(TOGETHER_SINCE)) + 1

  const [days, setDays] = useState(calcDays)

  useEffect(() => {
    const id = window.setInterval(() => setDays(calcDays()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="inline-flex flex-col items-start">
      <span className="text-xs tracking-[0.2em] text-[var(--ink-soft)] uppercase">
        {TOGETHER_LABEL}
      </span>
      <span className="font-display mt-1 text-5xl text-[var(--leaf)] sm:text-6xl">
        {days}
        <span className="ml-2 text-2xl text-[var(--ink-soft)]">天</span>
      </span>
      <span className="mt-2 text-sm text-[var(--ink-soft)]">自 {TOGETHER_SINCE}</span>
    </div>
  )
}
