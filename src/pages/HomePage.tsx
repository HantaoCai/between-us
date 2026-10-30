import { useMemo, useRef, useState } from 'react'
import { DaysTogether } from '../components/DaysTogether'
import { saveNotes, uploadPhoto } from '../lib/editApi'
import { useEditMode } from '../lib/editContext'
import {
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

const emptyDraft = (): Draft => ({
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

  const visible = useMemo(
    () => (filter === 'all' ? notes : notes.filter((n) => n.about === filter)),
    [filter, notes],
  )

  const wallH = wallHeightForCount(visible.length)

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

  function startPin(about: NoteAbout = 'her') {
    setDraft({ ...emptyDraft(), about })
  }

  function startEdit(note: StickyNote) {
    setDraft({
      id: note.id,
      text: note.text,
      detail: note.detail,
      about: note.about,
    })
  }

  async function submitDraft() {
    if (!draft) return
    const text = draft.text.trim()
    if (!text) {
      setError('先写一句')
      return
    }

    if (draft.id) {
      const next = notes.map((n) =>
        n.id === draft.id
          ? { ...n, text, detail: draft.detail.trim(), about: draft.about }
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
    setBusy(true)
    setError('')
    try {
      const uploaded = await uploadPhoto(file)
      const spot = findPinSpot(notes)
      const note: StickyNote = {
        id: `p-${Date.now()}`,
        kind: 'photo',
        text: uploaded.title || '照片',
        detail: '',
        about: 'her',
        src: uploaded.src,
        x: spot.x,
        y: spot.y,
        rotate: spot.rotate,
        tone: 'cream',
      }
      const next = [...notes, note]
      await saveNotes(next)
      setNotes(next)
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
              发现一点钉一张，好看的照片也钉上来。
              {enabled ? ' 贴纸可以随便拖。' : ''}
            </p>
          </div>
          <div className="rise-in rise-in-delay-3">
            <DaysTogether />
          </div>
        </div>

        <div className="relative z-10 mt-6 flex flex-wrap items-center gap-2">
          {(
            [
              ['all', '全部'],
              ['her', '她的'],
              ['me', '我的'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={[
                'px-3 py-1.5 text-sm transition',
                filter === key
                  ? 'bg-[var(--cork-ink)] text-[var(--foam)]'
                  : 'bg-black/5 text-[var(--cork-ink-soft)] hover:bg-black/10',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
          {enabled ? (
            <>
              <button
                type="button"
                onClick={() => startPin('her')}
                className="ml-auto bg-[var(--leaf)] px-4 py-1.5 text-sm text-[var(--foam)] transition hover:bg-[var(--leaf-bright)]"
              >
                钉她的
              </button>
              <button
                type="button"
                onClick={() => startPin('me')}
                className="border border-[var(--cork-ink)]/25 px-4 py-1.5 text-sm text-[var(--cork-ink)] transition hover:bg-black/5"
              >
                钉我的
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
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
          {visible.length === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[var(--cork-ink-soft)]">
              {filter === 'me'
                ? '还没有你的。发现一点，钉上来。'
                : filter === 'her'
                  ? '还没有她的。会一个技能，钉一个。'
                  : '墙还空着。'}
            </p>
          ) : (
            visible.map((note, i) => {
              const open = openId === note.id
              const isPhoto = note.kind === 'photo' && note.src
              const isDragging = draggingId === note.id
              return (
                <div
                  key={note.id}
                  className={[
                    'sticky-slot absolute',
                    isDragging ? 'is-dragging z-30' : 'z-[1] hover:z-20',
                    enabled ? 'can-drag' : '',
                  ].join(' ')}
                  style={{
                    left: `${note.x}%`,
                    top: `${note.y}%`,
                    ['--tilt' as string]: `${note.rotate}deg`,
                    animationDelay: isDragging ? undefined : `${0.04 * i}s`,
                  }}
                  onPointerDown={(e) => onPointerDown(e, note)}
                  onPointerMove={onPointerMove}
                  onPointerUp={(e) => void onPointerUp(e, note)}
                  onPointerCancel={(e) => void onPointerUp(e, note)}
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
              {draft.id ? '改这张' : '钉一张'}
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">一句技能或优点就够，细节可选。</p>

            <label className="mt-5 block text-xs text-[var(--ink-soft)]">关于谁</label>
            <div className="mt-2 flex gap-2">
              {(
                [
                  ['her', '她的'],
                  ['me', '我的'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDraft({ ...draft, about: key })}
                  className={[
                    'px-3 py-1.5 text-sm',
                    draft.about === key
                      ? 'bg-[var(--leaf)] text-[var(--foam)]'
                      : 'border border-[var(--leaf)]/25 text-[var(--ink-soft)]',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-xs text-[var(--ink-soft)]">便利贴上的字</label>
            <input
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              className="mt-1 w-full border border-[var(--leaf)]/25 bg-white/70 px-3 py-2 text-base outline-none focus:border-[var(--leaf)]"
              placeholder="会一个技能，钉一个"
              autoFocus
            />

            <label className="mt-4 block text-xs text-[var(--ink-soft)]">多说两句（可选）</label>
            <textarea
              value={draft.detail}
              onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
              rows={3}
              className="mt-1 w-full resize-none border border-[var(--leaf)]/25 bg-white/70 px-3 py-2 text-sm outline-none focus:border-[var(--leaf)]"
              placeholder="为什么觉得这一点好"
            />

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
                {busy ? '钉着…' : draft.id ? '保存' : '钉上墙'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 px-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox.src}
            alt={lightbox.text}
            className="max-h-[78svh] max-w-full object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="mt-3 font-hand text-xl text-white/90">{lightbox.text}</p>
          {lightbox.detail ? (
            <p className="mt-1 max-w-md text-center text-sm text-white/65">{lightbox.detail}</p>
          ) : null}
          {enabled ? (
            <div className="mt-3 flex gap-4" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="text-sm text-white/80 underline"
                onClick={() => {
                  startEdit(lightbox)
                  setLightbox(null)
                }}
              >
                改标题
              </button>
              <button
                type="button"
                className="text-sm text-red-200 underline"
                onClick={() => void removeNote(lightbox.id)}
              >
                取下
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="mt-4 text-sm text-white/60"
            onClick={() => setLightbox(null)}
          >
            关闭
          </button>
        </div>
      ) : null}
    </div>
  )
}
