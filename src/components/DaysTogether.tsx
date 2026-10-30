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

  const sinceShort = TOGETHER_SINCE.slice(5).replace('-', '/')

  return (
    <div className="days-lantern-dock">
      <div className="days-lantern-rail">
        <aside
          className="days-lantern"
          aria-label={`${TOGETHER_LABEL} ${days} 天，自 ${TOGETHER_SINCE}`}
        >
          <span className="days-lantern-hook" aria-hidden />
          <span className="days-lantern-cord" aria-hidden />
          <span className="days-lantern-cap" aria-hidden />
          <div className="days-lantern-body">
            <span className="days-lantern-glow" aria-hidden />
            <span className="days-lantern-label">{TOGETHER_LABEL}</span>
            <span className="days-lantern-days">
              {days}
              <small>天</small>
            </span>
            <span className="days-lantern-since">{sinceShort}</span>
          </div>
          <span className="days-lantern-base" aria-hidden />
          <span className="days-lantern-tassel" aria-hidden />
        </aside>
      </div>
    </div>
  )
}
