import { Outlet } from 'react-router-dom'
import { EditProvider, useEditMode } from '../lib/editContext'
import { SiteHeader } from './SiteHeader'

function EditHint() {
  const { enabled, ready } = useEditMode()
  if (!ready || !enabled) return null
  return (
    <div className="relative z-20 border-b border-[var(--leaf)]/15 bg-[var(--leaf)]/10 px-5 py-2 text-center text-xs text-[var(--leaf)] sm:px-8">
      本地编辑已开启：优点墙可钉便利贴，回忆与照片也能改。保存写入本机文件。
    </div>
  )
}

export function Layout() {
  return (
    <EditProvider>
      <div className="atmosphere grain relative min-h-svh overflow-x-hidden">
        <EditHint />
        <SiteHeader />
        <main className="relative z-10">
          <Outlet />
        </main>
        <footer className="relative z-10 mx-auto mt-8 w-full max-w-6xl px-4 pb-8 text-center text-xs text-[var(--ink-soft)] sm:px-6">
          双人记 · 发现一点，钉一张
        </footer>
      </div>
    </EditProvider>
  )
}
