import { Link } from 'react-router-dom'

/** 对战页不再单独开房：引导回大厅先开房间再选游戏 */
export function EnterRoomGate({
  busy,
  status,
  error,
  onRetry,
}: {
  busy?: boolean
  status?: string
  error?: string
  onRetry?: () => void
}) {
  if (busy) {
    return (
      <p className="py-12 text-center text-sm text-[var(--ink-soft)]">
        {status || '连接中…'}
      </p>
    )
  }

  const showRetry = !!(error && onRetry)

  return (
    <div className="space-y-5 py-6 text-center">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
        {error
          ? '可以再试一次进房，或回大厅重新开房。'
          : '对战要先开房间，再在大厅里选游戏。'}
      </p>
      <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
        {showRetry ? (
          <button type="button" className="game-lobby-primary" onClick={onRetry}>
            重新进房
          </button>
        ) : null}
        <Link
          to="/games"
          className={showRetry ? 'game-lobby-ghost' : 'game-lobby-primary'}
        >
          去开房
        </Link>
      </div>
    </div>
  )
}
