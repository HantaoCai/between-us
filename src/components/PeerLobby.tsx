import { type NoteAbout, aboutLabel } from '../lib/notes'

type Props = {
  busy?: boolean
  error?: string
  who: NoteAbout
  onWho: (who: NoteAbout) => void
  /** 是否允许第三人旁观；默认关 */
  allowSpectators?: boolean
  onAllowSpectators?: (next: boolean) => void
  /** 主按钮：开设新房间 */
  onEnter?: () => void
  enterLabel?: string
  busyLabel?: string
}

/** 大厅开房：先选身份，再开一间空房 */
export function PeerLobby({
  busy,
  error,
  who,
  onWho,
  allowSpectators = false,
  onAllowSpectators,
  onEnter,
  enterLabel = '开设房间',
  busyLabel = '开房中…',
}: Props) {
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
      {onAllowSpectators ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--ink-soft)]">旁观</span>
          <div className="wall-filter">
            <button
              type="button"
              className={!allowSpectators ? 'is-on' : ''}
              disabled={busy}
              onClick={() => onAllowSpectators(false)}
            >
              不允许
            </button>
            <button
              type="button"
              className={allowSpectators ? 'is-on' : ''}
              disabled={busy}
              onClick={() => onAllowSpectators(true)}
            >
              允许
            </button>
          </div>
        </div>
      ) : null}
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
