import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { prefetchGamesRoute } from '../lib/prefetchGames'
import { isPlayOnly } from '../lib/roomLink'
import { pauseWallPhotosForNavigation } from '../lib/wallPhotoGate'

/** 固定四项，避免切页时导航增减抖动；play-only 分享链仍只留小游戏 */
const navLinks = [
  { to: '/', label: '拾光', end: true },
  { to: '/wishlist', label: '清单', end: true },
  { to: '/eats', label: '转盘', end: true },
  { to: '/games', label: '小游戏', end: true },
]

export function SiteHeader() {
  const { pathname } = useLocation()
  const playOnly = isPlayOnly()
  const isHome = pathname === '/'
  const isGamesHome = pathname === '/games'
  const inPrivate =
    isHome || pathname === '/wishlist' || pathname === '/eats'
  const inGames = isGamesHome || pathname.startsWith('/games/')
  const inGameMatch = pathname.startsWith('/games/')
  const showNav = !playOnly && (inPrivate || isGamesHome)
  const links = playOnly
    ? navLinks.filter((link) => link.to === '/games')
    : showNav
      ? navLinks
      : []

  useEffect(() => {
    if (!isHome && !playOnly) return
    const run = () => prefetchGamesRoute()
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 2500 })
      return () => window.cancelIdleCallback(id)
    }
    const t = window.setTimeout(run, 800)
    return () => window.clearTimeout(t)
  }, [isHome, playOnly])

  if ((inGameMatch && !showNav) || (playOnly && isGamesHome)) {
    return (
      <header
        className="site-header relative z-40 mx-auto w-full max-w-6xl px-4 py-1.5 sm:px-6 sm:py-2"
        aria-hidden
      />
    )
  }

  return (
    <header
      className={[
        'site-header relative z-40 mx-auto flex w-full max-w-6xl items-center justify-end gap-4 px-4 sm:px-6',
        'py-3 sm:py-4',
        /* 首页也给导航留稳定右内边距，避免和灯笼抢位时整栏左右跳 */
        isHome ? 'is-wall-header pr-[5.75rem] sm:pr-[7rem]' : 'pr-[5.75rem] sm:pr-[7rem]',
      ].join(' ')}
    >
      {showNav ? (
        <nav className="site-nav flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-[var(--ink-soft)] sm:gap-x-4">
          {links.map((link) => {
            const isGamesLink = link.to === '/games'
            const active =
              link.to === '/games'
                ? inGames
                : link.to === '/'
                  ? isHome
                  : pathname === link.to
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                onPointerDown={
                  isGamesLink
                    ? () => {
                        pauseWallPhotosForNavigation()
                        prefetchGamesRoute()
                      }
                    : undefined
                }
                onTouchStart={
                  isGamesLink
                    ? () => {
                        pauseWallPhotosForNavigation()
                        prefetchGamesRoute()
                      }
                    : undefined
                }
                className={[
                  'site-nav-link inline-flex min-h-11 items-center px-1 transition-colors hover:text-[var(--leaf)]',
                  active ? 'is-active text-[var(--leaf)]' : '',
                ].join(' ')}
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
