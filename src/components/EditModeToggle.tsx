import { useState, type FormEvent } from 'react'
import { useEditMode } from '../lib/editContext'

/** 墙上 / 照片页：口令解锁编辑；本机会话内有效 */
export function EditModeToggle({ className = '' }: { className?: string }) {
  const { available, enabled, ready, authRequired, unlock, lock } = useEditMode()
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!ready || !available) return null

  if (enabled) {
    return (
      <button
        type="button"
        onClick={lock}
        className={`wall-pin-link inline-flex min-h-11 items-center px-1 text-sm text-[var(--ink-soft)] transition-colors hover:text-[var(--leaf)] ${className}`}
      >
        收起编辑
      </button>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await unlock(token)
      setOpen(false)
      setToken('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '口令不对')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setError('')
        }}
        className="wall-pin-link inline-flex min-h-11 items-center px-1 text-sm text-[var(--ink-soft)] transition-colors hover:text-[var(--leaf)]"
      >
        编辑
      </button>
      {open ? (
        <form
          onSubmit={submit}
          className="absolute left-0 top-full z-40 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-[var(--leaf)]/15 bg-[var(--foam)]/95 p-3 shadow-[0_12px_32px_rgba(42,34,24,0.12)] backdrop-blur-sm"
        >
          {authRequired ? (
            <>
              <label className="block text-xs text-[var(--ink-soft)]">
                编辑口令
                <input
                  type="password"
                  autoComplete="current-password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="mt-1.5 w-full border border-[var(--leaf)]/25 bg-white/80 px-3 py-2 text-sm outline-none focus:border-[var(--leaf)]"
                  placeholder="与 Worker PROXY_TOKEN 相同"
                  autoFocus
                />
              </label>
              <button
                type="submit"
                disabled={busy || !token.trim()}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center bg-[var(--leaf)] px-3 text-sm text-[var(--foam)] disabled:opacity-50"
              >
                {busy ? '验证中…' : '解锁'}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-[var(--ink-soft)]">
                服务端未配置 PROXY_TOKEN，写接口仍裸奔。建议在 Worker 配上口令。
              </p>
              <button
                type="submit"
                disabled={busy}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center bg-[var(--leaf)] px-3 text-sm text-[var(--foam)] disabled:opacity-50"
              >
                {busy ? '进入中…' : '仍要编辑'}
              </button>
            </>
          )}
          {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
        </form>
      ) : null}
    </div>
  )
}
