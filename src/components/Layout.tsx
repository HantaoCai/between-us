import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { EditProvider } from '../lib/editContext'
import { PlayBackdrop } from './PlayBackdrop'
import { SiteHeader } from './SiteHeader'

export function Layout() {
  const { pathname } = useLocation()
  const isHome = pathname === '/'
  const isGames = pathname === '/games' || pathname.startsWith('/games/')
  const isGameLobby = pathname === '/games'

  // 手机墙锁死整页滚动（iOS 单靠 overflow:hidden 仍会橡皮筋）
  useEffect(() => {
    if (!isHome) return
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
  }, [isHome])

  return (
    <EditProvider>
      <div
        className={[
          'app-shell grain relative overflow-x-hidden',
          isGames ? 'play-atmosphere' : 'atmosphere',
          isHome ? 'is-wall-home' : '',
        ].join(' ')}
      >
        {isGames ? <PlayBackdrop lobby={isGameLobby} /> : null}
        <SiteHeader />
        <main className={['relative z-10', isHome ? 'wall-main' : ''].join(' ')}>
          <Outlet />
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
