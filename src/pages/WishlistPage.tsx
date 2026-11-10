import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { EditModeToggle } from '../components/EditModeToggle'
import { fetchSharedDoc, saveSharedDoc } from '../lib/editApi'
import { useEditMode } from '../lib/editContext'
import { nextTone, type NoteTone } from '../lib/notes'
import {
  createWishlistItem,
  normalizeWishlist,
  seedWishlist,
  toggleWishlistDone,
  type WishlistItem,
} from '../lib/wishlist'

function toneFor(id: string, index: number): NoteTone {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i) * (i + 3)) % 97
  return nextTone(hash + index)
}

function tiltFor(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i) * 17) % 21
  return hash - 10
}

export function WishlistPage() {
  const { available, enabled, ready } = useEditMode()
  const [items, setItems] = useState<WishlistItem[]>(seedWishlist)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editNote, setEditNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!ready) return
      try {
        if (!available) {
          if (!cancelled) {
            setItems(seedWishlist)
            setLoaded(true)
          }
          return
        }
        const raw = await fetchSharedDoc('wishlist')
        if (cancelled) return
        setItems(normalizeWishlist(raw))
      } catch (e) {
        if (cancelled) return
        if (e instanceof Error && e.message === 'cloud-doc-missing') {
          setItems(seedWishlist)
        } else {
          setError(e instanceof Error ? e.message : '读取失败')
          setItems(seedWishlist)
        }
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [available, ready])

  const openItems = useMemo(() => items.filter((item) => !item.done), [items])
  const doneItems = useMemo(() => items.filter((item) => item.done), [items])

  async function persist(next: WishlistItem[]) {
    setItems(next)
    if (!enabled) return
    setBusy(true)
    setError('')
    try {
      await saveSharedDoc('wishlist', next)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    const nextTitle = title.trim()
    if (!nextTitle || !enabled || busy) return
    const next = [createWishlistItem(nextTitle, note), ...items]
    setTitle('')
    setNote('')
    await persist(next)
  }

  async function onToggle(id: string) {
    if (!enabled || busy) return
    const next = items.map((item) =>
      item.id === id ? toggleWishlistDone(item) : item,
    )
    await persist(next)
  }

  async function onRemove(id: string) {
    if (!enabled || busy) return
    await persist(items.filter((item) => item.id !== id))
  }

  function startEdit(item: WishlistItem) {
    setEditingId(item.id)
    setEditTitle(item.title)
    setEditNote(item.note)
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingId || !enabled || busy) return
    const nextTitle = editTitle.trim()
    if (!nextTitle) return
    const next = items.map((item) =>
      item.id === editingId
        ? {
            ...item,
            title: nextTitle.slice(0, 80),
            note: editNote.trim().slice(0, 200),
          }
        : item,
    )
    setEditingId(null)
    await persist(next)
  }

  return (
    <section className="wish-page mx-auto w-full max-w-3xl px-5 pb-20 pt-4 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.18em] text-[var(--ink-soft)]">BETWEEN US</p>
          <h1 className="font-display rise-in mt-1 text-4xl text-[var(--ink)] sm:text-5xl">
            愿望清单
          </h1>
          <p className="rise-in rise-in-delay-1 mt-3 max-w-lg text-[var(--ink-soft)]">
            想一起去做的事
          </p>
        </div>
        <EditModeToggle />
      </div>

      <div className="wish-meter mt-6" aria-live="polite">
        <span>还想做 {openItems.length}</span>
        <span className="wish-meter-dot" aria-hidden />
        <span>做过 {doneItems.length}</span>
      </div>

      {enabled ? (
        <form onSubmit={onAdd} className="wish-composer sticky-cream mt-8">
          <span className="wish-pin" aria-hidden />
          <p className="wish-composer-label font-hand">再钉一张</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="想一起做的一件事"
            maxLength={80}
            className="wish-input"
            disabled={busy}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="一句备注，可空"
            maxLength={200}
            className="wish-input is-soft"
            disabled={busy}
          />
          <button
            type="submit"
            className="wish-composer-btn"
            disabled={busy || !title.trim()}
          >
            {busy ? '钉着…' : '钉上去'}
          </button>
        </form>
      ) : (
        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          {available
            ? '点右上角「编辑」解锁后可增删改。'
            : '当前只读；本地 npm run dev 或配置云端口令后可编辑。'}
        </p>
      )}

      {!loaded ? (
        <p className="mt-10 text-sm text-[var(--ink-soft)]">加载中…</p>
      ) : (
        <div className="wish-board mt-8">
          <WishBoard
            title="还想做"
            items={openItems}
            empty="板子空着，先钉一件小事。"
            enabled={enabled}
            busy={busy}
            editingId={editingId}
            editTitle={editTitle}
            editNote={editNote}
            onEditTitle={setEditTitle}
            onEditNote={setEditNote}
            onStartEdit={startEdit}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={saveEdit}
            onToggle={onToggle}
            onRemove={onRemove}
          />
          <WishBoard
            title="做过了"
            items={doneItems}
            empty=""
            enabled={enabled}
            busy={busy}
            editingId={editingId}
            editTitle={editTitle}
            editNote={editNote}
            onEditTitle={setEditTitle}
            onEditNote={setEditNote}
            onStartEdit={startEdit}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={saveEdit}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        </div>
      )}

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
    </section>
  )
}

function WishBoard({
  title,
  items,
  empty,
  enabled,
  busy,
  editingId,
  editTitle,
  editNote,
  onEditTitle,
  onEditNote,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggle,
  onRemove,
}: {
  title: string
  items: WishlistItem[]
  empty: string
  enabled: boolean
  busy: boolean
  editingId: string | null
  editTitle: string
  editNote: string
  onEditTitle: (v: string) => void
  onEditNote: (v: string) => void
  onStartEdit: (item: WishlistItem) => void
  onCancelEdit: () => void
  onSaveEdit: (e: FormEvent) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}) {
  const [menuId, setMenuId] = useState<string | null>(null)

  useEffect(() => {
    if (!menuId) return
    function onDoc(e: PointerEvent) {
      const target = e.target as HTMLElement | null
      if (!target?.closest(`[data-wish-menu="${menuId}"]`)) {
        setMenuId(null)
      }
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [menuId])

  if (items.length === 0) {
    if (!empty) return null
    return (
      <div className="wish-section">
        <h2 className="wish-section-title">{title}</h2>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">{empty}</p>
      </div>
    )
  }

  return (
    <div className="wish-section">
      <h2 className="wish-section-title">
        {title}
        <span>{items.length}</span>
      </h2>
      <ul className="wish-grid">
        {items.map((item, index) => {
          const tone = toneFor(item.id, index)
          const tilt = tiltFor(item.id)
          const editing = editingId === item.id
          const menuOpen = menuId === item.id
          return (
            <li
              key={item.id}
              className={`wish-note sticky-${tone} ${item.done ? 'is-done' : ''} ${editing ? 'is-editing' : ''}`}
              style={{ ['--wish-tilt' as string]: `${tilt / 10}deg` }}
              data-wish-menu={item.id}
            >
              <span className="wish-pin" aria-hidden />
              {editing ? (
                <form onSubmit={onSaveEdit} className="space-y-2">
                  <input
                    value={editTitle}
                    onChange={(e) => onEditTitle(e.target.value)}
                    className="wish-input"
                    maxLength={80}
                    disabled={busy}
                  />
                  <input
                    value={editNote}
                    onChange={(e) => onEditNote(e.target.value)}
                    className="wish-input is-soft"
                    maxLength={200}
                    disabled={busy}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className="wish-mini-btn is-leaf" disabled={busy}>
                      保存
                    </button>
                    <button
                      type="button"
                      className="wish-mini-btn"
                      onClick={onCancelEdit}
                      disabled={busy}
                    >
                      取消
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {item.done ? (
                    <span className="wish-stamp font-hand" aria-hidden>
                      做过了
                    </span>
                  ) : null}
                  <div className="wish-note-main">
                    <p className="wish-title font-hand">{item.title}</p>
                    {item.note ? <p className="wish-note-text">{item.note}</p> : null}
                    <p className="wish-meta">
                      {item.done && item.doneAt ? item.doneAt : item.createdAt}
                    </p>
                  </div>
                  {enabled ? (
                    <div className="wish-more">
                      <button
                        type="button"
                        className="wish-more-btn"
                        aria-label="更多操作"
                        aria-expanded={menuOpen}
                        disabled={busy}
                        onClick={() =>
                          setMenuId((cur) => (cur === item.id ? null : item.id))
                        }
                      >
                        ···
                      </button>
                      {menuOpen ? (
                        <div className="wish-more-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy}
                            onClick={() => {
                              setMenuId(null)
                              onToggle(item.id)
                            }}
                          >
                            {item.done ? '收回清单' : '标为做过'}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy}
                            onClick={() => {
                              setMenuId(null)
                              onStartEdit(item)
                            }}
                          >
                            改写
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy}
                            onClick={() => {
                              setMenuId(null)
                              onRemove(item.id)
                            }}
                          >
                            撕掉
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
