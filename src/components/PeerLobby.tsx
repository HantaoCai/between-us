import { aboutLabel, otherAbout, type NoteAbout } from '../lib/notes'

type Props = {
  busy?: boolean
  error?: string
  who: NoteAbout
  onWho: (who: NoteAbout) => void
  onEnter: () => void
  enterLabel?: string
  /** 链接里已有房间号时的补充说明 */
  roomHint?: string
}

export function PeerLobby({
  busy,
  error,
  who,
  onWho,
  onEnter,
  enterLabel = '进房间',
  roomHint,
}: Props) {
  return (
    <div className="space-y-5">
      <div className="game-lobby-options">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--ink-soft)]">先到的人是</span>
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
          后到自动是 {aboutLabel(otherAbout(who))}。打开同一个链接就进同一间房。
        </p>
        {roomHint ? (
          <p className="text-xs text-[var(--ink-soft)]">{roomHint}</p>
        ) : null}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onEnter}
        className="game-lobby-primary"
      >
        {busy ? '进房中…' : enterLabel}
      </button>

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
