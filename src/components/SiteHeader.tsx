import { NavLink, useLocation } from 'react-router-dom'

const links = [
  { to: '/', label: '墙', end: true },
  { to: '/games', label: '小游戏', end: true },
]

export function SiteHeader() {
  const { pathname } = useLocation()
  const isHome = pathname === '/'
  const inGames = pathname === '/games' || pathname.startsWith('/games/')

  return (
    <header
      className={[
        'relative z-20 mx-auto flex w-full max-w-6xl items-center justify-end gap-4 px-4 py-3 sm:px-6 sm:py-4',
        /* 首页右上留给相识灯笼 */
        isHome ? 'pr-[5.5rem] sm:pr-[6.5rem]' : '',
      ].join(' ')}
    >
      <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-sm text-[var(--ink-soft)] sm:gap-x-4">
        {links.map((link) => {
          const gamesActive = link.to === '/games' && inGames
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                [
                  'inline-flex min-h-11 items-center px-1 transition-colors hover:text-[var(--leaf)]',
                  isActive || gamesActive ? 'text-[var(--leaf)]' : '',
                ].join(' ')
              }
            >
              {link.label}
            </NavLink>
          )
        })}
      </nav>
    </header>
  )
}
