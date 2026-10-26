import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: '首页', end: true },
  { to: '/timeline', label: '时间线', end: false },
  { to: '/photos', label: '照片墙', end: false },
  { to: '/how', label: '怎么用', end: false },
]

export function SiteHeader() {
  return (
    <header className="relative z-20 mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
      <NavLink to="/" className="group flex items-baseline gap-2">
        <span className="font-display text-2xl tracking-wide text-[var(--ink)] transition-colors group-hover:text-[var(--leaf)]">
          双人记
        </span>
        <span className="hidden text-xs text-[var(--ink-soft)] sm:inline">我们的事</span>
      </NavLink>
      <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-sm text-[var(--ink-soft)]">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              [
                'transition-colors hover:text-[var(--leaf)]',
                isActive ? 'text-[var(--leaf)]' : '',
              ].join(' ')
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}
