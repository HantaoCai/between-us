import { aboutLabel, otherAbout, type NoteAbout } from '../lib/notes'

type Props = {
  busy?: boolean
  error?: string
  who: NoteAbout
  onWho: (who: NoteAbout) => void
  onEnter: () => void
  enterLabel?: string
}

/** 开房大厅：选身份后创建房间；后到扫码不会走到这里 */
export function PeerLobby({
  busy,
  error,
  who,
  onWho,
  onEnter,
  enterLabel = '创建房间',
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
          对方扫码进房后自动是 {aboutLabel(otherAbout(who))}。
        </p>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onEnter}
        className="game-lobby-primary"
      >
        {busy ? '创建中…' : enterLabel}
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
