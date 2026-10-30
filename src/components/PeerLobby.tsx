import { useState } from 'react'
import { normalizeRoomCode } from '../lib/guessGame'
import { aboutLabel, otherAbout, type NoteAbout } from '../lib/notes'

type Props = {
  busy?: boolean
  error?: string
  who: NoteAbout
  onWho: (who: NoteAbout) => void
  onCreate: () => void
  onJoin: (code: string) => void
  extra?: React.ReactNode
}

export function PeerLobby({
  busy,
  error,
  who,
  onWho,
  onCreate,
  onJoin,
  extra,
}: Props) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [roomInput, setRoomInput] = useState('')
  const joining = mode === 'join'

  return (
    <div className="space-y-5">
      <div
        className={joining ? 'game-lobby-options is-locked' : 'game-lobby-options'}
        inert={joining || undefined}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--ink-soft)]">开房的人是</span>
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
          加入方自动是 {aboutLabel(otherAbout(who))}
        </p>

        {extra}
      </div>

      <div className="wall-filter game-lobby-tabs">
        <button
          type="button"
          className={mode === 'create' ? 'is-on' : ''}
          onClick={() => setMode('create')}
        >
          开房
        </button>
        <button
          type="button"
          className={mode === 'join' ? 'is-on' : ''}
          onClick={() => setMode('join')}
        >
          加入
        </button>
      </div>

      {mode === 'create' ? (
        <button
          type="button"
          disabled={busy}
          onClick={onCreate}
          className="game-lobby-primary"
        >
          {busy ? '开房中…' : '开一局'}
        </button>
      ) : (
        <div className="game-lobby-join">
          <input
            value={roomInput}
            onChange={(e) => setRoomInput(normalizeRoomCode(e.target.value))}
            maxLength={6}
            placeholder="六位房间号"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            autoCorrect="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onJoin(roomInput)
            }}
          />
          <button
            type="button"
            disabled={busy || roomInput.length < 6}
            onClick={() => onJoin(roomInput)}
          >
            {busy ? '…' : '进入'}
          </button>
        </div>
      )}

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
