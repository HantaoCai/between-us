import { Link } from 'react-router-dom'
import { deleteMemory } from '../lib/editApi'
import { useEditMode } from '../lib/editContext'
import { kindLabel, type Memory } from '../lib/memories'
import { useState } from 'react'

type Props = {
  items: Memory[]
  empty: string
  datePrefix?: string
  showKind?: boolean
}

export function MemoryCardList({
  items,
  empty,
  datePrefix = '',
  showKind = false,
}: Props) {
  const { enabled } = useEditMode()
  const [busySlug, setBusySlug] = useState('')

  async function handleDelete(slug: string, title: string) {
    if (!window.confirm(`确定删除？\n${title}\n\n会删除对应 Markdown，照片文件保留。`)) {
      return
    }
    setBusySlug(slug)
    try {
      await deleteMemory(slug)
      window.location.reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '删除失败')
      setBusySlug('')
    }
  }

  if (items.length === 0) {
    return <p className="mt-12 text-[var(--ink-soft)]">{empty}</p>
  }

  return (
    <ul className="mt-12 space-y-8">
      {items.map((memory, index) => (
        <li
          key={memory.slug}
          className="rise-in border-t border-[var(--leaf)]/20 pt-6"
          style={{ animationDelay: `${0.06 * index}s` }}
        >
          <Link to={`/m/${memory.slug}`} className="group block max-w-2xl">
            <p className="text-xs tracking-wider text-[var(--ink-soft)]">
              {showKind ? `${kindLabel(memory.kind)} · ` : ''}
              {datePrefix}
              {memory.date}
              {memory.place ? ` · ${memory.place}` : ''}
            </p>
            <h2 className="font-display mt-2 text-3xl text-[var(--ink)] transition-colors group-hover:text-[var(--leaf)]">
              {memory.title}
            </h2>
            {memory.mood ? (
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{memory.mood}</p>
            ) : null}
            {memory.cover ? (
              <img
                src={memory.cover}
                alt=""
                className="mt-5 aspect-[16/10] w-full max-w-md object-cover"
                loading="lazy"
              />
            ) : null}
          </Link>
          {enabled ? (
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <Link to={`/m/${memory.slug}?edit=1`} className="text-[var(--leaf)]">
                编辑
              </Link>
              <button
                type="button"
                disabled={busySlug === memory.slug}
                className="text-red-800 disabled:opacity-60"
                onClick={() => handleDelete(memory.slug, memory.title)}
              >
                {busySlug === memory.slug ? '删除中…' : '删除'}
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
