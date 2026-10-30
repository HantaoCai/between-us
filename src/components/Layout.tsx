import { Outlet, useLocation } from 'react-router-dom'
import { EditProvider } from '../lib/editContext'
import { PlayBackdrop } from './PlayBackdrop'
import { ResumeRoomBanner } from './ResumeRoomBanner'
import { SiteHeader } from './SiteHeader'

export function Layout() {
  const { pathname } = useLocation()
  const isGames = pathname === '/games' || pathname.startsWith('/games/')
  const isGameLobby = pathname === '/games'

  return (
    <EditProvider>
      <div
        className={[
          'app-shell grain relative overflow-x-hidden',
          isGames ? 'play-atmosphere' : 'atmosphere',
        ].join(' ')}
      >
        {isGames ? <PlayBackdrop lobby={isGameLobby} /> : null}
        <SiteHeader />
        <ResumeRoomBanner />
        <main className="relative z-10">
          <Outlet />
        </main>
        {isGames ? null : (
          <footer className="relative z-10 mx-auto mt-8 w-full max-w-6xl px-4 pb-8 text-center text-xs text-[var(--ink-soft)] sm:px-6">
            Between Us · 发现一点，钉一张
          </footer>
        )}
      </div>
    </EditProvider>
  )
}
