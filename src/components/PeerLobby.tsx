import { aboutLabel, otherAbout, type NoteAbout } from '../lib/notes'

type Props = {
  busy?: boolean
  error?: string
  who: NoteAbout
  onWho: (who: NoteAbout) => void
  /** 主按钮：进入 / 重试进房 */
  onEnter?: () => void
  enterLabel?: string
  busyLabel?: string
  /** 次要：换一间常用房 */
  onResetRoom?: () => void
  hint?: string
}

/** 常用房大厅：选身份后进入固定房间；后到带链接进房不会走到这里 */
export function PeerLobby({
  busy,
  error,
  who,
  onWho,
  onEnter,
  enterLabel = '进入房间',
  busyLabel = '进入中…',
  onResetRoom,
  hint,
}: Props) {
  return (
    <div className="space-y-5">
      <div className="game-lobby-options">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--ink-soft)]">我是</span>
          <div className="wall-filter">
            {(
              [
                ['her', aboutLabel('her')],
                ['me', aboutLabel('me')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={who === key ? 'is-on' : ''}
                onClick={() => onWho(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-[var(--ink-soft)]">
          {hint ??
            `对方进房后自动是 ${aboutLabel(otherAbout(who))}。收藏同一链接即可。`}
        </p>
      </div>

      {onEnter ? (
        <button
          type="button"
          disabled={busy}
          onClick={onEnter}
          className="game-lobby-primary"
        >
          {busy ? busyLabel : enterLabel}
        </button>
      ) : null}

      {onResetRoom ? (
        <button
          type="button"
          disabled={busy}
          onClick={onResetRoom}
          className="game-lobby-ghost"
        >
          换一间房
        </button>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  )
}

export function RoomBanner({
  code,
  detail,
}: {
  code: string
  detail?: string
}) {
  return (
    <div className="game-room">
      <div>
        <p className="text-xs tracking-[0.2em] text-[var(--ink-soft)]">房间</p>
        <p className="game-room-code">{code}</p>
      </div>
      {detail ? (
        <p className="max-w-[10rem] text-right text-xs leading-relaxed text-[var(--ink-soft)]">
          {detail}
        </p>
      ) : null}
    </div>
  )
}
