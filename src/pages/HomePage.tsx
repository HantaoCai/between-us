import { useRef, useState } from 'react'
import { DaysTogether } from '../components/DaysTogether'
import { saveNotes, uploadPhoto } from '../lib/editApi'
import { useEditMode } from '../lib/editContext'
import {
  aboutLabel,
  findPinSpot,
  nextTone,
  notes as seedNotes,
  wallHeightForCount,
  type NoteAbout,
  type StickyNote,
} from '../lib/notes'

type Filter = 'all' | NoteAbout

type Draft = {
  id?: string
  mode: 'text' | 'photo'
  text: string
  detail: string
  about: NoteAbout
}

type DragState = {
  id: string
  pointerId: number
  startClientX: number
  startClientY: number
  originX: number
  originY: number
  moved: boolean
}

const emptyTextDraft = (): Draft => ({
  mode: 'text',
  text: '',
  detail: '',
  about: 'her',
})

const emptyPhotoDraft = (): Draft => ({
  mode: 'photo',
  text: '',
  detail: '',
  about: 'her',
})

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function HomePage() {
  const { enabled } = useEditMode()
  const [notes, setNotes] = useState<StickyNote[]>(seedNotes)
  const [filter, setFilter] = useState<Filter>('all')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<StickyNote | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const wallRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const notesRef = useRef(notes)
  const draftBackdropDown = useRef(false)
  notesRef.current = notes

  const wallH = wallHeightForCount(notes.length)

  async function persist(next: StickyNote[], clearDraft = true) {
    setBusy(true)
    setError('')
    try {
      await saveNotes(next)
      setNotes(next)
      if (clearDraft) setDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  function startPinText() {
    setDraft(emptyTextDraft())
  }

  function startPinPhoto() {
    setDraft(emptyPhotoDraft())
  }

  function startEdit(note: StickyNote) {
    setDraft({
      id: note.id,
      mode: note.kind === 'photo' ? 'photo' : 'text',
      text: note.text,
      detail: note.detail,
      about: note.about,
    })
  }

  async function submitDraft() {
    if (!draft) return

    if (draft.mode === 'photo' && !draft.id) {
      // 新照片：先选标签，再选文件
      fileRef.current?.click()
      return
    }

    const text = draft.text.trim()
    if (draft.mode === 'text' && !text) {
      setError('先写一句')
      return
    }

    if (draft.id) {
      const next = notes.map((n) =>
        n.id === draft.id
          ? {
              ...n,
              text: text || n.text,
              detail: draft.detail.trim(),
              about: draft.about,
            }
          : n,
      )
      await persist(next)
      return
    }

    const spot = findPinSpot(notes)
    const note: StickyNote = {
      id: `n-${Date.now()}`,
      kind: 'text',
      text,
      detail: draft.detail.trim(),
      about: draft.about,
      src: '',
      x: spot.x,
      y: spot.y,
      rotate: spot.rotate,
      tone: nextTone(notes.length),
    }
    await persist([...notes, note])
  }

  async function pinPhotoFile(file: File) {
    const about = draft?.about ?? 'her'
    const caption = draft?.text.trim()
    setBusy(true)
    setError('')
    try {
      const uploaded = await uploadPhoto(file)
      const spot = findPinSpot(notes)
      const note: StickyNote = {
        id: `p-${Date.now()}`,
        kind: 'photo',
        text: caption || uploaded.title || '照片',
        detail: draft?.detail.trim() || '',
        about,
        src: uploaded.src,
        x: spot.x,
        y: spot.y,
        rotate: spot.rotate,
        tone: 'cream',
      }
      const next = [...notes, note]
      await saveNotes(next)
      setNotes(next)
      setDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '钉照片失败')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeNote(id: string) {
    if (!window.confirm('从墙上取下这张？')) return
    await persist(notes.filter((n) => n.id !== id))
    if (openId === id) setOpenId(null)
    if (lightbox?.id === id) setLightbox(null)
  }

  async function setNoteAbout(id: string, about: NoteAbout) {
    const next = notesRef.current.map((n) => (n.id === id ? { ...n, about } : n))
    notesRef.current = next
    setNotes(next)
    setLightbox((prev) => (prev && prev.id === id ? { ...prev, about } : prev))
    if (!enabled) {
      setError('需要本地 npm run dev 才能保存标签')
      return
    }
    try {
      await saveNotes(next)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '标签保存失败')
    }
  }

  function onPinClick(note: StickyNote) {
    if (note.kind === 'photo') {
      setLightbox(note)
      return
    }
    setOpenId(openId === note.id ? null : note.id)
  }

  function onPointerDown(e: React.PointerEvent, note: StickyNote) {
    if (!enabled) return
    if (e.button !== 0) return
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    dragRef.current = {
      id: note.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: note.x,
      originY: note.y,
      moved: false,
    }
    setDraggingId(note.id)
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    const wall = wallRef.current
    if (!drag || !wall || drag.pointerId !== e.pointerId) return

    const dxPx = e.clientX - drag.startClientX
    const dyPx = e.clientY - drag.startClientY
    if (!drag.moved && Math.hypot(dxPx, dyPx) > 5) {
      drag.moved = true
    }
    if (!drag.moved) return

    const rect = wall.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    // 坐标是贴纸中心，可拖到靠右贴边
    const x = clamp(drag.originX + (dxPx / rect.width) * 100, 6, 94)
    const y = clamp(drag.originY + (dyPx / rect.height) * 100, 2, 78)
    setNotes((prev) =>
      prev.map((n) =>
        n.id === drag.id
          ? { ...n, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
          : n,
      ),
    )
  }

  async function onPointerUp(e: React.PointerEvent, note: StickyNote) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setDraggingId(null)

    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }

    if (!drag.moved) {
      onPinClick(note)
      return
    }

    if (enabled) {
      try {
        await saveNotes(notesRef.current)
      } catch (err) {
        setError(err instanceof Error ? err.message : '位置保存失败')
      }
    }
  }

  return (
    <div className="wall-page">
      <section className="relative mx-auto flex w-full max-w-6xl flex-col px-4 pb-8 pt-2 sm:px-6">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4 px-1 pt-2">
          <div>
            <p className="rise-in text-xs tracking-[0.28em] text-[var(--cork-ink-soft)]">
              SHUANGREN JI
            </p>
            <h1 className="rise-in rise-in-delay-1 font-display mt-2 text-5xl leading-none text-[var(--cork-ink)] sm:text-6xl md:text-7xl">
              双人记
            </h1>
            <p className="rise-in rise-in-delay-2 mt-3 max-w-md text-sm leading-relaxed text-[var(--cork-ink-soft)] sm:text-base">
              贴纸和照片钉在同一面墙，用「全部 / 佳佳 / 晗涛」筛选。
              {enabled ? ' 可拖动，照片也能打标签。' : ''}
            </p>
          </div>
          <div className="rise-in rise-in-delay-3">
            <DaysTogether />
          </div>
        </div>

        <div className="relative z-10 mt-6 flex flex-wrap items-center gap-3">
          <div className="wall-filter" role="tablist" aria-label="墙上筛选">
            {(
              [
                ['all', '全部'],
                ['her', aboutLabel('her')],
                ['me', aboutLabel('me')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => {
                  setFilter(key)
                  setOpenId(null)
                }}
                className={filter === key ? 'is-on' : ''}
              >
                {label}
              </button>
            ))}
          </div>
          {enabled ? (
            <>
              <button
                type="button"
                onClick={startPinText}
                className="ml-auto bg-[var(--leaf)] px-4 py-1.5 text-sm text-[var(--foam)] transition hover:bg-[var(--leaf-bright)]"
              >
                钉贴纸
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={startPinPhoto}
                className="border border-[var(--cork-ink)]/25 px-4 py-1.5 text-sm text-[var(--cork-ink)] transition hover:bg-black/5 disabled:opacity-50"
              >
                钉照片
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void pinPhotoFile(file)
                }}
              />
            </>
          ) : null}
        </div>

        <div
          ref={wallRef}
          className={[
            'cork-wall rise-in rise-in-delay-2 relative mt-5 w-full overflow-hidden',
            draggingId ? 'is-dragging-wall' : '',
          ].join(' ')}
          style={{ height: wallH }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setOpenId(null)
          }}
        >
          {notes.length === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[var(--cork-ink-soft)]">
              墙还空着。
            </p>
          ) : (
            notes.map((note, i) => {
              const open = openId === note.id
              const isPhoto = note.kind === 'photo' && note.src
              const isDragging = draggingId === note.id
              const shown = filter === 'all' || note.about === filter
              return (
                <div
                  key={note.id}
                  className={[
                    'sticky-slot absolute',
                    isDragging ? 'is-dragging z-30' : 'z-[1] hover:z-20',
                    enabled ? 'can-drag' : '',
                    shown ? '' : 'is-filtered-out',
                  ].join(' ')}
                  style={{
                    left: `${note.x}%`,
                    top: `${note.y}%`,
                    ['--tilt' as string]: `${note.rotate}deg`,
                    animationDelay: isDragging ? undefined : `${0.04 * i}s`,
                  }}
                  onPointerDown={(e) => {
                    if (!shown) return
                    onPointerDown(e, note)
                  }}
                  onPointerMove={onPointerMove}
                  onPointerUp={(e) => {
                    if (!shown) return
                    void onPointerUp(e, note)
                  }}
                  onPointerCancel={(e) => {
                    if (!shown) return
                    void onPointerUp(e, note)
                  }}
                >
                  <button
                    type="button"
                    className={[
                      isPhoto ? 'sticky-photo' : `sticky-note sticky-${note.tone}`,
                      !isPhoto && open ? 'is-open' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={(e) => {
                      // 点击由 pointerUp 处理，避免拖完又点开
                      if (enabled) e.preventDefault()
                      else onPinClick(note)
                    }}
                  >
                    <span className="sticky-pin" aria-hidden />
                    {isPhoto ? (
                      <>
                        <img
                          src={note.src}
                          alt={note.text}
                          loading="lazy"
                          draggable={false}
                        />
                        {note.text ? (
                          <span className="sticky-photo-caption font-hand">{note.text}</span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="font-hand text-lg leading-none text-[var(--cork-ink)] sm:text-xl">
                          {note.text}
                        </span>
                        {open && note.detail ? (
                          <span className="mt-3 block border-t border-black/10 pt-2 text-xs leading-relaxed text-[var(--cork-ink-soft)]">
                            {note.detail}
                          </span>
                        ) : null}
                      </>
                    )}
                    {open && !isPhoto && enabled ? (
                      <span className="mt-3 flex gap-2">
                        <span
                          role="button"
                          tabIndex={0}
                          className="text-xs text-[var(--leaf)] underline"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            startEdit(note)
                          }}
                        >
                          改
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          className="text-xs text-red-700/80 underline"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            void removeNote(note.id)
                          }}
                        >
                          取下
                        </span>
                      </span>
                    ) : null}
                  </button>
                </div>
              )
            })
          )}
        </div>

        {error ? (
          <p className="mt-3 text-center text-sm text-red-700">{error}</p>
        ) : null}
      </section>

      {draft ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4"
          onPointerDown={(e) => {
            draftBackdropDown.current = e.target === e.currentTarget
          }}
          onPointerUp={(e) => {
            // 只有按下和松开都在遮罩上才关闭，避免框内选字/拖出窗外误关丢内容
            if (
              draftBackdropDown.current &&
              e.target === e.currentTarget &&
              !busy
            ) {
              setDraft(null)
            }
            draftBackdropDown.current = false
          }}
        >
          <div
            className="w-full max-w-md bg-[var(--foam)] p-5 shadow-xl"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-2xl text-[var(--ink)]">
              {draft.id
                ? '改这张'
                : draft.mode === 'photo'
                  ? '钉照片'
                  : '钉贴纸'}
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              {draft.mode === 'photo'
                ? '先打上「佳佳 / 晗涛」，再选图片。都在同一面墙上，用上面筛选看。'
                : '先打标签，再写一句。都在同一面墙上筛选。'}
            </p>

            <label className="mt-5 block text-xs text-[var(--ink-soft)]">标签</label>
            <div className="wall-filter mt-2">
              {(
                [
                  ['her', aboutLabel('her')],
                  ['me', aboutLabel('me')],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDraft({ ...draft, about: key })}
                  className={draft.about === key ? 'is-on' : ''}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-xs text-[var(--ink-soft)]">
              {draft.mode === 'photo' ? '标题（可选）' : '便利贴上的字'}
            </label>
            <input
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              className="mt-1 w-full border border-[var(--leaf)]/25 bg-white/70 px-3 py-2 text-base outline-none focus:border-[var(--leaf)]"
              placeholder={
                draft.mode === 'photo' ? '这张照片叫什么' : '会一个技能，钉一个'
              }
              autoFocus
            />

            {draft.mode === 'text' ? (
              <>
                <label className="mt-4 block text-xs text-[var(--ink-soft)]">
                  多说两句（可选）
                </label>
                <textarea
                  value={draft.detail}
                  onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
                  rows={3}
                  className="mt-1 w-full resize-none border border-[var(--leaf)]/25 bg-white/70 px-3 py-2 text-sm outline-none focus:border-[var(--leaf)]"
                  placeholder="为什么觉得这一点好"
                />
              </>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDraft(null)}
                className="px-4 py-2 text-sm text-[var(--ink-soft)]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitDraft()}
                className="bg-[var(--leaf)] px-4 py-2 text-sm text-[var(--foam)] disabled:opacity-50"
              >
                {busy
                  ? '钉着…'
                  : draft.id
                    ? '保存'
                    : draft.mode === 'photo'
                      ? '选图片钉上'
                      : '钉上墙'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <div className="photo-lightbox">
          <button
            type="button"
            className="photo-lightbox-dim"
            aria-label="关闭"
            onClick={() => setLightbox(null)}
          />
          <div className="photo-lightbox-stage">
            <img
              src={lightbox.src}
              alt={lightbox.text}
              className="photo-lightbox-img"
              draggable={false}
            />
            <p className="photo-lightbox-title font-hand">{lightbox.text}</p>
            {lightbox.detail ? (
              <p className="photo-lightbox-detail">{lightbox.detail}</p>
            ) : null}
          </div>

          {/* 固定在底部，避免大图把按钮顶出屏幕点不到 */}
          <div className="photo-lightbox-bar">
            <div className="wall-filter wall-filter-dark">
              {(
                [
                  ['her', aboutLabel('her')],
                  ['me', aboutLabel('me')],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={lightbox.about === key ? 'is-on' : ''}
                  onClick={() => {
                    if (lightbox.about === key) return
                    void setNoteAbout(lightbox.id, key)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="photo-lightbox-actions">
              {enabled ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      startEdit(lightbox)
                      setLightbox(null)
                    }}
                  >
                    改标题
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => void removeNote(lightbox.id)}
                  >
                    取下
                  </button>
                </>
              ) : null}
              <button type="button" onClick={() => setLightbox(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
