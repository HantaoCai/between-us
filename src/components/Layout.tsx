import { Suspense, useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { EditProvider } from '../lib/editContext'
import {
  isPlayOnly,
  isPlayOnlyBlockedPath,
} from '../lib/roomLink'
import { pauseWallPhotosForNavigation } from '../lib/wallPhotoGate'
import { PlayBackdrop } from './PlayBackdrop'
import { SiteHeader } from './SiteHeader'

function RouteFallback() {
  return (
    <div
      className="flex min-h-[40vh] flex-col items-center justify-center gap-2 px-6 text-sm text-[var(--ink-soft)]"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="font-display text-lg text-[var(--ink)]">Between Us</span>
      <span>加载中…</span>
    </div>
  )
}

/** 整页锁死、只允许壳内局部滚：小游戏 / 清单 / 转盘 */
function isShellLockPath(pathname: string): boolean {
  return (
    pathname.startsWith('/games') ||
    pathname === '/wishlist' ||
    pathname === '/eats'
  )
}

export function Layout() {
  const { pathname } = useLocation()
  const isHome = pathname === '/'
  const isGames = pathname === '/games' || pathname.startsWith('/games/')
  const isGameLobby = pathname === '/games'
  const isEats = pathname === '/eats'
  const isWishlist = pathname === '/wishlist'
  const shellLock = isShellLockPath(pathname)
  const playOnly = isPlayOnly()
  const blockWall = playOnly && isPlayOnlyBlockedPath(pathname)

  // 手机墙：锁死整页滚动
  useEffect(() => {
    if (!isHome || playOnly) return
    const root = document.documentElement
    const mq = window.matchMedia('(max-width: 639px)')
    const sync = () => {
      root.classList.toggle('wall-no-scroll', mq.matches)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => {
      mq.removeEventListener('change', sync)
      root.classList.remove('wall-no-scroll')
    }
  }, [isHome, playOnly])

  // 壳锁页统一：html/body 不再整页滑
  useEffect(() => {
    if (!shellLock) return
    const root = document.documentElement
    root.classList.add('shell-no-scroll')
    return () => {
      root.classList.remove('shell-no-scroll')
    }
  }, [shellLock])

  useEffect(() => {
    if (!isGames) return
    pauseWallPhotosForNavigation()
  }, [isGames])

  if (blockWall) {
    return <Navigate to="/games" replace />
  }

  return (
    <EditProvider>
      <div
        className={[
          'app-shell grain relative overflow-x-hidden',
          isGames ? 'play-atmosphere' : 'atmosphere',
          shellLock ? 'is-shell-lock' : '',
          isHome ? 'is-wall-home' : '',
          isEats ? 'is-eats' : '',
          isWishlist ? 'is-wishlist' : '',
        ].join(' ')}
      >
        {isGames ? <PlayBackdrop lobby={isGameLobby} /> : null}
        <SiteHeader />
        <main
          className={[
            'relative z-10',
            isHome ? 'wall-main' : '',
            shellLock ? 'shell-main' : '',
          ].join(' ')}
        >
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
        {shellLock || isHome ? null : (
          <footer className="relative z-[2] mx-auto mt-8 w-full max-w-6xl px-4 pb-8 text-center text-xs text-[var(--ink-soft)] sm:px-6">
            Between Us · 发现一点，钉一张
          </footer>
        )}
      </div>
    </EditProvider>
  )
}
