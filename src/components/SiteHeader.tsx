import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: '墙', end: true },
  { to: '/milestones', label: '时光', end: false },
  { to: '/how', label: '怎么用', end: false },
]

export function SiteHeader() {
  return (
    <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
      <NavLink to="/" className="group flex items-baseline gap-2">
        <span className="font-display text-2xl tracking-wide text-[var(--ink)] transition-colors group-hover:text-[var(--leaf)]">
          双人记
        </span>
      </NavLink>
      <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-sm text-[var(--ink-soft)] sm:gap-x-4">
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
