import { Outlet } from 'react-router-dom'
import { SiteHeader } from './SiteHeader'

export function Layout() {
  return (
    <div className="atmosphere grain relative min-h-svh overflow-x-hidden">
      <SiteHeader />
      <main className="relative z-10">
        <Outlet />
      </main>
      <footer className="relative z-10 mx-auto mt-16 w-full max-w-5xl px-5 pb-10 text-center text-xs text-[var(--ink-soft)] sm:px-8">
        双人记 · 用 Markdown 记下小事，用网页慢慢翻
      </footer>
    </div>
  )
}
