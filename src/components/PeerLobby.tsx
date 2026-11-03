import { type NoteAbout, aboutLabel } from '../lib/notes'
import { lobbyHintForMode } from '../lib/hubRoom'

type Props = {
  busy?: boolean
  error?: string
  who: NoteAbout
  onWho: (who: NoteAbout) => void
  /** 主按钮：开设新房间 */
  onEnter?: () => void
  enterLabel?: string
  busyLabel?: string
  hint?: string
}

/** 大厅开房：先选身份，再开一间空房 */
export function PeerLobby({
  busy,
  error,
  who,
  onWho,
  onEnter,
  enterLabel = '开设房间',
  busyLabel = '开房中…',
  hint,
}: Props) {
  const defaultHint = lobbyHintForMode('pick', who)

  return (
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
              disabled={busy}
              onClick={() => onWho(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-[var(--ink-soft)]">{hint ?? defaultHint}</p>
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
