import { useState, type FormEvent } from 'react'
import { useEditMode } from '../lib/editContext'

/** 线上编辑口令解锁；本地编辑或未配置远端 API 时不显示 */
export function EditUnlock() {
  const { remote, needsUnlock, enabled, unlock, lock, ready } = useEditMode()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!ready || !remote) return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const ok = await unlock(password)
    setBusy(false)
    if (ok) {
      setPassword('')
      setOpen(false)
      return
    }
    setError('口令不对')
  }

  if (enabled && !needsUnlock) {
    return (
      <button
        type="button"
        onClick={() => lock()}
        className="site-nav-link inline-flex min-h-11 items-center px-1 text-sm text-[var(--ink-soft)] transition-colors hover:text-[var(--leaf)]"
        title="退出线上编辑"
      >
        锁编辑
      </button>
    )
  }

  if (!needsUnlock) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setError('')
        }}
        className="site-nav-link inline-flex min-h-11 items-center px-1 text-sm text-[var(--ink-soft)] transition-colors hover:text-[var(--leaf)]"
      >
        解锁编辑
      </button>
      {open ? (
        <form
          onSubmit={submit}
          className="absolute right-0 top-full z-40 mt-1 w-56 rounded-md border border-[var(--leaf)]/20 bg-[var(--paper)] p-3 shadow-sm"
        >
          <label className="block text-xs text-[var(--ink-soft)]">
            编辑口令
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full border border-[var(--leaf)]/25 bg-white/80 px-2 py-1.5 text-sm outline-none focus:border-[var(--leaf)]"
            />
          </label>
          {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
          <button
            type="submit"
            disabled={busy || !password.trim()}
            className="mt-2 w-full bg-[var(--leaf)] px-2 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {busy ? '验证中…' : '解锁'}
          </button>
        </form>
      ) : null}
    </div>
  )
}
