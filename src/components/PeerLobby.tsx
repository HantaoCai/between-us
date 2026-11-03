import { type NoteAbout, aboutLabel } from '../lib/notes'
import {
  lobbyHintForMode,
  type LobbySeatMode,
} from '../lib/hubRoom'

export type { LobbySeatMode }

type Props = {
  busy?: boolean
  error?: string
  who: NoteAbout
  onWho: (who: NoteAbout) => void
  /** 主按钮：进入房间 */
  onEnter?: () => void
  enterLabel?: string
  busyLabel?: string
  /** 按在线人数：空房自选 / 已有一人自动对侧 / 满员旁观 */
  seatMode?: LobbySeatMode
  hint?: string
}

/** 常驻房大厅：空房选身份；已有一人则自动另一边；满两人旁观 */
export function PeerLobby({
  busy,
  error,
  who,
  onWho,
  onEnter,
  enterLabel = '进入房间',
  busyLabel = '进入中…',
  seatMode = 'pick',
  hint,
}: Props) {
  const pick = seatMode === 'pick'
  const spectate = seatMode === 'spectate'
  const defaultHint = lobbyHintForMode(seatMode, who)

  return (
    <div className="space-y-5">
      {spectate ? (
        <p className="text-sm text-[var(--ink-soft)]">{hint ?? defaultHint}</p>
      ) : (
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
                  disabled={!pick || busy}
                  onClick={() => onWho(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-[var(--ink-soft)]">{hint ?? defaultHint}</p>
        </div>
      )}

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
