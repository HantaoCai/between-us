import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { fetchSharedDoc, saveSharedDoc } from '../lib/editApi'
import { useEditMode } from '../lib/editContext'
import { nextTone, type NoteTone } from '../lib/notes'
import {
  createWishlistItem,
  normalizeWishlist,
  readLocalWishlist,
  seedWishlist,
  toggleWishlistDone,
  writeLocalWishlist,
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
  const { available, ready } = useEditMode()
  const [items, setItems] = useState<WishlistItem[]>(
    () => readLocalWishlist() ?? seedWishlist,
  )
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editNote, setEditNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [showDone, setShowDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!ready) return
      const local = readLocalWishlist()
      try {
        if (!available) {
          if (!cancelled) {
            setItems(local ?? seedWishlist)
            setLoaded(true)
          }
          return
        }
        const raw = await fetchSharedDoc('wishlist')
        if (cancelled) return
        const remote = normalizeWishlist(raw)
        setItems(remote.length > 0 ? remote : local ?? seedWishlist)
        if (remote.length > 0) writeLocalWishlist(remote)
      } catch (e) {
        if (cancelled) return
        if (e instanceof Error && e.message === 'cloud-doc-missing') {
          setItems(local ?? seedWishlist)
        } else {
          setItems(local ?? seedWishlist)
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
    writeLocalWishlist(next)
    if (!available) return
    setBusy(true)
    setError('')
    try {
      await saveSharedDoc('wishlist', next)
    } catch {
      // 本机已保存；云端无口令时不同步即可
    } finally {
      setBusy(false)
    }
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    const nextTitle = title.trim()
    if (!nextTitle || busy) return
    const next = [createWishlistItem(nextTitle, note), ...items]
    setTitle('')
    setNote('')
    setAdding(false)
    await persist(next)
  }

  async function onToggle(id: string) {
    if (busy) return
    const next = items.map((item) =>
      item.id === id ? toggleWishlistDone(item) : item,
    )
    await persist(next)
  }

  async function onRemove(id: string) {
    if (busy) return
    await persist(items.filter((item) => item.id !== id))
  }

  function startEdit(item: WishlistItem) {
    setEditingId(item.id)
    setEditTitle(item.title)
    setEditNote(item.note)
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editingId || busy) return
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
    <section className="wish-page">
      <div className="wish-top">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display rise-in text-4xl text-[var(--ink)] sm:text-5xl">
              还想做
            </h1>
            <p className="rise-in rise-in-delay-1 mt-2 text-[var(--ink-soft)]">
              想一起去做的事
              {loaded ? (
                <span className="wish-count"> · {openItems.length}</span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            className="wish-add-btn"
            disabled={busy}
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? '取消' : '+ 钉一张'}
          </button>
        </div>

        {adding ? (
          <form onSubmit={onAdd} className="wish-add-form mt-4">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="想一起做的事"
              maxLength={80}
              className="wish-input"
              disabled={busy}
              autoFocus
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="备注，可空"
              maxLength={200}
              className="wish-input is-soft"
              disabled={busy}
            />
            <button
              type="submit"
              className="wish-mini-btn is-leaf"
              disabled={busy || !title.trim()}
            >
              {busy ? '钉着…' : '钉上'}
            </button>
          </form>
        ) : null}
      </div>

      <div className="wish-scroll">
        {!loaded ? (
          <p className="mt-6 text-sm text-[var(--ink-soft)]">加载中…</p>
        ) : (
          <div className="wish-board">
            {openItems.length === 0 ? (
              <p className="wish-empty">还没有想一起做的事</p>
            ) : (
              <WishGrid
                items={openItems}
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
            )}

            {doneItems.length > 0 ? (
              <div className="wish-done-block">
                <button
                  type="button"
                  className="wish-done-toggle"
                  onClick={() => setShowDone((v) => !v)}
                >
                  做过了 {doneItems.length}
                  <span>{showDone ? '收起' : '看看'}</span>
                </button>
                {showDone ? (
                  <WishGrid
                    items={doneItems}
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
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      </div>
    </section>
  )
}

function WishGrid({
  items,
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
  items: WishlistItem[]
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

  if (items.length === 0) return null

  return (
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
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}
