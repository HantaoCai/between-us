import { Suspense, useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { EditProvider } from '../lib/editContext'
import {
  isPlayOnly,
  isPlayOnlyBlockedPath,
} from '../lib/roomLink'
import { PlayBackdrop } from './PlayBackdrop'
import { SiteHeader } from './SiteHeader'

function RouteFallback() {
  return (
    <div
      className="flex min-h-[30vh] items-center justify-center px-6 text-sm text-[var(--ink-soft)]"
      aria-busy="true"
    >
      加载中…
    </div>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  const isHome = pathname === '/'
  const isGames = pathname === '/games' || pathname.startsWith('/games/')
  const isGameLobby = pathname === '/games'
  const playOnly = isPlayOnly()
  const blockWall = playOnly && isPlayOnlyBlockedPath(pathname)

  // 手机墙锁死整页滚动（iOS 单靠 overflow:hidden 仍会橡皮筋）
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

  // 小游戏全区锁死整页滑动：只允许壳内局部区域滚
  useEffect(() => {
    if (!isGames) return
    const root = document.documentElement
    root.classList.add('game-no-scroll')
    return () => {
      root.classList.remove('game-no-scroll')
    }
  }, [isGames])

  if (blockWall) {
    return <Navigate to="/games" replace />
  }

  return (
    <EditProvider>
      <div
        className={[
          'app-shell grain relative overflow-x-hidden',
          isGames ? 'play-atmosphere is-games' : 'atmosphere',
          isHome ? 'is-wall-home' : '',
        ].join(' ')}
      >
        {isGames ? <PlayBackdrop lobby={isGameLobby} /> : null}
        <SiteHeader />
        <main
          className={[
            'relative z-10',
            isHome ? 'wall-main' : '',
            isGames ? 'games-main' : '',
          ].join(' ')}
        >
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
        {isGames || isHome ? null : (
          <footer className="relative z-[2] mx-auto mt-8 w-full max-w-6xl px-4 pb-8 text-center text-xs text-[var(--ink-soft)] sm:px-6">
            Between Us · 发现一点，钉一张
          </footer>
        )}
      </div>
    </EditProvider>
  )
}
