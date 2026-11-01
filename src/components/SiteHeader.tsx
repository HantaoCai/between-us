import { NavLink, useLocation } from 'react-router-dom'

const links = [
  { to: '/', label: '拾光', end: true },
  { to: '/games', label: '小游戏', end: true },
]

export function SiteHeader() {
  const { pathname } = useLocation()
  const isHome = pathname === '/'
  const isGamesHome = pathname === '/games'
  const inGames = isGamesHome || pathname.startsWith('/games/')
  const inGameMatch = pathname.startsWith('/games/')
  // 对局中不展示拾光 / 小游戏；导航只在拾光首页与游戏大厅
  const showNav = isHome || isGamesHome

  if (inGameMatch && !showNav) {
    return (
      <header
        className="site-header relative z-20 mx-auto w-full max-w-6xl px-4 py-1.5 sm:px-6 sm:py-2"
        aria-hidden
      />
    )
  }

  return (
    <header
      className={[
        'site-header relative z-20 mx-auto flex w-full max-w-6xl items-center justify-end gap-4 px-4 sm:px-6',
        inGameMatch ? 'py-1.5 sm:py-2' : 'py-3 sm:py-4',
        /* 首页右上留给相识灯笼（宽 + 内容栏右内边距） */
        isHome ? 'is-wall-header pr-[5.75rem] sm:pr-[7rem]' : '',
      ].join(' ')}
    >
      {showNav ? (
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
                    'site-nav-link inline-flex min-h-11 items-center px-1 transition-colors hover:text-[var(--leaf)]',
                    isActive || gamesActive ? 'text-[var(--leaf)]' : '',
                  ].join(' ')
                }
              >
                {link.label}
              </NavLink>
            )
          })}
        </nav>
      ) : null}
    </header>
  )
}
