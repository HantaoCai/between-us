import type { RematchAsk } from '../lib/rematchConsent'

/**
 * 双方同意再来一局的统一 UI。
 * mode=done：终局申请入口；mode=play：对局中被申请时打断。
 */
export function RematchConsentBar({
  ask,
  spectating,
  mode = 'done',
  onAsk,
  onAccept,
  onReject,
  askLabel = '申请再来一局',
  decideLabel = '对方申请再来一局',
  playDecideLabel = '对方申请重开本局',
  waitingLabel = '已申请再来，等对方同意…',
  playWaitingLabel = '已申请重开，等对方同意…',
  spectatingLabel = '旁观中，等他们再来一局',
}: {
  ask: RematchAsk
  spectating?: boolean
  mode?: 'done' | 'play'
  onAsk: () => void
  onAccept: () => void
  onReject: () => void
  askLabel?: string
  decideLabel?: string
  playDecideLabel?: string
  waitingLabel?: string
  playWaitingLabel?: string
  spectatingLabel?: string
}) {
  if (spectating) {
    if (mode !== 'done') return null
    return (
      <p className="text-center text-sm text-[var(--ink-soft)]">{spectatingLabel}</p>
    )
  }

  if (ask === 'decide') {
    return (
      <div className="guess-consent" role="status">
        <p>{mode === 'play' ? playDecideLabel : decideLabel}</p>
        <div className="guess-consent-actions">
          <button
            type="button"
            className="game-btn game-btn-leaf flex-1"
            onClick={onAccept}
          >
            同意
          </button>
          <button
            type="button"
            className="game-btn game-btn-ghost flex-1"
            onClick={onReject}
          >
            拒绝
          </button>
        </div>
      </div>
    )
  }

  if (ask === 'waiting') {
    return (
      <p
        className={
          mode === 'play'
            ? 'text-center text-xs text-[var(--ink-soft)]'
            : 'text-center text-sm text-[var(--ink-soft)]'
        }
      >
        {mode === 'play' ? playWaitingLabel : waitingLabel}
      </p>
    )
  }

  if (mode === 'done') {
    return (
      <button type="button" className="game-btn game-btn-leaf w-full" onClick={onAsk}>
        {askLabel}
      </button>
    )
  }

  return null
}
