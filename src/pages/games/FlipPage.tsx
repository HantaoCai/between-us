import { useMemo, useState } from 'react'
import { GameShell } from '../../components/GameShell'

const ICONS = ['☕', '🌧️', '🌙', '🍃', '📷', '🍜']

type Card = { id: number; icon: string; matched: boolean }

function shuffle<T>(list: T[]): T[] {
  const next = [...list]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function buildDeck(): Card[] {
  const pairs = ICONS.flatMap((icon, i) => [
    { id: i * 2, icon, matched: false },
    { id: i * 2 + 1, icon, matched: false },
  ])
  return shuffle(pairs)
}

export function FlipPage() {
  const [deck, setDeck] = useState(buildDeck)
  const [open, setOpen] = useState<number[]>([])
  const [moves, setMoves] = useState(0)
  const [lock, setLock] = useState(false)

  const done = useMemo(() => deck.every((c) => c.matched), [deck])

  function reset() {
    setDeck(buildDeck())
    setOpen([])
    setMoves(0)
    setLock(false)
  }

  function flip(index: number) {
    if (lock) return
    const card = deck[index]
    if (!card || card.matched || open.includes(index)) return

    const nextOpen = [...open, index]
    setOpen(nextOpen)

    if (nextOpen.length < 2) return

    setMoves((m) => m + 1)
    const [a, b] = nextOpen
    if (deck[a].icon === deck[b].icon) {
      setDeck((prev) =>
        prev.map((c, i) => (i === a || i === b ? { ...c, matched: true } : c)),
      )
      setOpen([])
      return
    }

    setLock(true)
    window.setTimeout(() => {
      setOpen([])
      setLock(false)
    }, 650)
  }

  return (
    <GameShell title="翻翻乐">
      <p className="text-sm text-[var(--ink-soft)]">
        步数 {moves}
        {done ? ' · 全部配对！' : ''}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {deck.map((card, index) => {
          const shown = card.matched || open.includes(index)
          return (
            <button
              key={card.id}
              type="button"
              disabled={card.matched || lock}
              onClick={() => flip(index)}
              className={[
                'aspect-square text-3xl transition active:scale-95',
                shown
                  ? 'bg-white/80'
                  : 'bg-[var(--leaf)] text-[var(--foam)]',
              ].join(' ')}
            >
              {shown ? card.icon : '?'}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={reset}
        className="mt-6 w-full border border-[var(--leaf)]/30 py-2 text-sm text-[var(--ink-soft)]"
      >
        再来一局
      </button>
    </GameShell>
  )
}
