import { useEffect } from 'react'
import { NavLink, useLocation, useNavigation } from 'react-router-dom'
import { prefetchGamesRoute } from '../lib/prefetchGames'
import { isPlayOnly } from '../lib/roomLink'
import { pauseWallPhotosForNavigation } from '../lib/wallPhotoGate'

/** 私密区：仅拾光侧展示，不进可分享的小游戏页 */
const privateLinks = [
  { to: '/', label: '拾光', end: true },
  { to: '/wishlist', label: '清单', end: true },
  { to: '/eats', label: '转盘', end: true },
]

const gamesLink = { to: '/games', label: '小游戏', end: true }

export function SiteHeader() {
  const { pathname } = useLocation()
  const navigation = useNavigation()
  const playOnly = isPlayOnly()
  const isHome = pathname === '/'
  const isGamesHome = pathname === '/games'
  const inPrivate =
    isHome || pathname === '/wishlist' || pathname === '/eats'
  const inGames = isGamesHome || pathname.startsWith('/games/')
  const inGameMatch = pathname.startsWith('/games/')
  // 对局中不展示导航；play-only 分享链不露私密标签
  // 拾光侧：私密标签 + 小游戏；小游戏大厅：只留「拾光 / 小游戏」
  const showNav = !playOnly && (inPrivate || isGamesHome)
  const links = inPrivate
    ? [...privateLinks, gamesLink]
    : isGamesHome
      ? [privateLinks[0]!, gamesLink]
      : []
  const goingGames =
    navigation.state === 'loading' &&
    navigation.location?.pathname.startsWith('/games')
  const privateActive = pathname === '/wishlist' || pathname === '/eats'

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
        inGameMatch ? 'py-1.5 sm:py-2' : 'py-3 sm:py-4',
        isHome ? 'is-wall-header pr-[5.75rem] sm:pr-[7rem]' : '',
      ].join(' ')}
    >
      {showNav ? (
        <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-sm text-[var(--ink-soft)] sm:gap-x-4">
          {links.map((link) => {
            const gamesActive = link.to === '/games' && inGames
            const isGamesLink = link.to === '/games'
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
                className={({ isActive }) =>
                  [
                    'site-nav-link inline-flex min-h-11 items-center px-1 transition-colors hover:text-[var(--leaf)]',
                    isActive ||
                    gamesActive ||
                    (isGamesLink && goingGames) ||
                    (link.to === '/' && isHome && !privateActive)
                      ? 'text-[var(--leaf)]'
                      : '',
                  ].join(' ')
                }
              >
                {isGamesLink && goingGames ? '进入中…' : link.label}
              </NavLink>
            )
          })}
        </nav>
      ) : null}
    </header>
  )
}
