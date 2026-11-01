import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { DaysTogether } from '../components/DaysTogether'
import { WallPhoto } from '../components/WallPhoto'
import { assetUrl } from '../lib/assetUrl'
import { deletePhoto, fetchNotes, saveNotes, uploadPhoto } from '../lib/editApi'
import { useEditMode } from '../lib/editContext'
import { reportHomeView } from '../lib/statsApi'
import { memories } from '../lib/memories'
import {
  findPinSpot,
  nextTone,
  normalizeNotes,
  notes as seedNotes,
  wallHeightForCount,
  type StickyNote,
} from '../lib/notes'
import { getExtras } from '../lib/photos'

type ViewMode = 'wall' | 'browse'

type Draft = {
  id?: string
  mode: 'text' | 'photo'
  text: string
  detail: string
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
})

const emptyPhotoDraft = (): Draft => ({
  mode: 'photo',
  text: '',
  detail: '',
})

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function isMobileWall() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 640px)').matches
  )
}

/** 回忆封面、挂了回忆、或墙上还有另一张同一文件时，只取钉、不删文件 */
function pinnedFileCanGo(src: string, exceptId: string, list: StickyNote[]) {
  if (!src) return false
  if (memories.some((m) => m.cover === src)) return false
  if (list.some((n) => n.id !== exceptId && n.src === src)) return false
  if (getExtras().some((p) => p.src === src && p.slug)) return false
  return true
}

export function HomePage() {
  const { enabled, ready } = useEditMode()
  const [notes, setNotes] = useState<StickyNote[]>(seedNotes)
  const [viewMode, setViewMode] = useState<ViewMode>('wall')
  /** 手机墙面只看不拖，避免误触把钉挪乱 */
  const [allowDrag, setAllowDrag] = useState(() => !isMobileWall())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  /** 批量钉图进度，如「2/5」 */
  const [pinProgress, setPinProgress] = useState('')
  const [error, setError] = useState('')
  const [viewerCount, setViewerCount] = useState<number | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<StickyNote | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const wallRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const notesRef = useRef(notes)
  const draftBackdropDown = useRef(false)
  const draftRef = useRef(draft)
  const previewUrlsRef = useRef(previewUrls)
  notesRef.current = notes
  previewUrlsRef.current = previewUrls
  draftRef.current = draft

  const visiblePhotos = notes.filter((n) => n.kind === 'photo' && n.src)

  useEffect(() => {
    return () => {
      for (const url of Object.values(previewUrlsRef.current)) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    reportHomeView().then((stats) => {
      if (!cancelled && stats) setViewerCount(stats.uv)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const sync = () => setAllowDrag(!mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // 可编辑时从本机或 Cloudflare R2 拉墙，避免只用构建进包的旧 notes
  useEffect(() => {
    if (!ready || !enabled) return
    let cancelled = false
    fetchNotes()
      .then((list) => {
        if (cancelled) return
        const next = normalizeNotes(list)
        setNotes(next)
        notesRef.current = next
      })
      .catch((err) => {
        // cloud-notes-missing：R2 还没有墙，保留打包数据，首次钉图再写入
        if (err instanceof Error && err.message === 'cloud-notes-missing') return
        /* 其它失败也保持当前墙 */
      })
    return () => {
      cancelled = true
    }
  }, [ready, enabled])

  const wallH = wallHeightForCount(notes.length)

  async function persist(next: StickyNote[], clearDraft = true) {
    setBusy(true)
    setError('')
    try {
      await saveNotes(next)
      setNotes(next)
      notesRef.current = next
      if (clearDraft) setDraft(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
      return false
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
    })
  }

  async function submitDraft() {
    if (!draft) return

    // 新建照片改由 label 直接触发选图（手机上程序点 hidden input 常被拦）
    if (draft.mode === 'photo' && !draft.id) return

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
      about: 'her',
      src: '',
      x: spot.x,
      y: spot.y,
      rotate: spot.rotate,
      tone: nextTone(notes.length),
    }
    await persist([...notes, note])
  }

  async function pinPhotoFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) {
      setError('请选择图片')
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    const caption = draft?.text.trim()
    const detail = draft?.detail.trim() || ''
    const stamp = Date.now()
    setBusy(true)
    setPinProgress(images.length > 1 ? `0/${images.length}` : '')
    setError('')
    setDraft(null)

    let wall = notesRef.current
    let pinned = 0

    try {
      for (let i = 0; i < images.length; i++) {
        const file = images[i]
        if (images.length > 1) {
          setPinProgress(`${i + 1}/${images.length}`)
        }
        const localPreview = URL.createObjectURL(file)
        try {
          const uploaded = await uploadPhoto(file)
          const spot = findPinSpot(wall)
          const note: StickyNote = {
            id: `p-${stamp}-${i}`,
            kind: 'photo',
            text:
              (images.length === 1 ? caption : i === 0 ? caption : '') ||
              uploaded.title ||
              '照片',
            detail,
            about: 'her',
            src: uploaded.src,
            x: spot.x,
            y: spot.y,
            rotate: spot.rotate,
            tone: 'cream',
          }
          // 先上墙（blob 立刻能看见），整批结束再落盘
          setPreviewUrls((prev) => ({ ...prev, [note.id]: localPreview }))
          wall = [...wall, note]
          setNotes(wall)
          notesRef.current = wall
          pinned += 1
        } catch (err) {
          URL.revokeObjectURL(localPreview)
          throw err
        }
      }
      await saveNotes(wall)
    } catch (err) {
      if (pinned > 0) {
        try {
          await saveNotes(wall)
        } catch {
          /* 已钉上的尽量保住；下面仍报本次失败 */
        }
        setError(
          err instanceof Error
            ? `已钉上 ${pinned} 张，第 ${pinned + 1} 张失败：${err.message}`
            : `已钉上 ${pinned} 张，后面失败了`,
        )
      } else {
        setError(err instanceof Error ? err.message : '钉照片失败')
      }
    } finally {
      setBusy(false)
      setPinProgress('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeNote(id: string) {
    const list = notesRef.current
    const note = list.find((n) => n.id === id)
    if (!note) return
    const isPhoto = note.kind === 'photo' && Boolean(note.src)
    const dropFile = isPhoto && pinnedFileCanGo(note.src, id, list)
    const message = dropFile
      ? '从墙上取下这张？\n照片文件也会一起删掉。'
      : '从墙上取下这张？'
    if (!window.confirm(message)) return
    setPreviewUrls((prev) => {
      const url = prev[id]
      if (url) URL.revokeObjectURL(url)
      const next = { ...prev }
      delete next[id]
      return next
    })
    const saved = await persist(list.filter((n) => n.id !== id))
    if (!saved) return
    if (openId === id) setOpenId(null)
    if (lightbox?.id === id) setLightbox(null)
    if (dropFile) {
      try {
        await deletePhoto(note.src)
      } catch (err) {
        setError(err instanceof Error ? err.message : '照片文件删除失败，已从墙上取下')
      }
    }
  }

  function onPinClick(note: StickyNote) {
    if (note.kind === 'photo') {
      setLightbox(note)
      return
    }
    setOpenId(openId === note.id ? null : note.id)
  }

  function stepLightbox(dir: -1 | 1) {
    if (!lightbox || visiblePhotos.length === 0) return
    const i = visiblePhotos.findIndex((p) => p.id === lightbox.id)
    if (i < 0) {
      setLightbox(visiblePhotos[0])
      return
    }
    const next = visiblePhotos[(i + dir + visiblePhotos.length) % visiblePhotos.length]
    setLightbox(next)
  }

  function onPointerDown(e: React.PointerEvent, note: StickyNote) {
    if (!enabled || !allowDrag) return
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
      {viewerCount != null ? (
        <span
          className="pointer-events-none fixed left-1 top-0 z-[30] font-mono text-[9px] leading-none text-[var(--ink-soft)]/45 sm:left-1.5 sm:top-0.5 sm:text-[10px]"
          aria-hidden
        >
          {viewerCount}
        </span>
      ) : null}
      <DaysTogether />
      <section className="wall-page-body relative mx-auto flex w-full max-w-6xl flex-col px-4 pb-8 pt-0 sm:px-6 sm:pt-2">
        <div className="wall-page-head relative z-10 px-1 pr-20 sm:pr-28">
          <h1 className="wall-title rise-in font-display text-[1.55rem] leading-none text-[var(--cork-ink)] sm:text-6xl md:text-7xl">
            <Link to="/" className="transition-colors hover:text-[var(--leaf)]">
              Between Us
            </Link>
          </h1>
        </div>

        <div className="wall-page-tools relative z-10 mt-3 flex flex-wrap items-center gap-2 pr-20 sm:mt-5 sm:gap-3 sm:pr-28">
          <div className="wall-filter" role="tablist" aria-label="查看方式">
            {(
              [
                ['wall', '墙面'],
                ['browse', '浏览'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={viewMode === key}
                onClick={() => setViewMode(key)}
                className={viewMode === key ? 'is-on' : ''}
              >
                {label}
              </button>
            ))}
          </div>
          {enabled ? (
            <div className="wall-page-pin-actions flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--ink-soft)] sm:gap-x-4">
              <button
                type="button"
                onClick={startPinText}
                className="wall-pin-link inline-flex min-h-11 items-center px-1 transition-colors hover:text-[var(--leaf)]"
              >
                钉贴纸
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={startPinPhoto}
                className="wall-pin-link inline-flex min-h-11 items-center px-1 transition-colors hover:text-[var(--leaf)] disabled:opacity-50"
              >
                {busy && pinProgress
                  ? `钉着… ${pinProgress}`
                  : busy
                    ? '钉着…'
                    : '钉照片'}
              </button>
            </div>
          ) : null}
        </div>

        {viewMode === 'browse' ? (
          <div className="wall-browse rise-in rise-in-delay-2 mt-5">
            {notes.length === 0 ? (
              <p className="py-16 text-center text-sm text-[var(--ink-soft)]">
                这边还没有内容。
              </p>
            ) : (
              <ul className="wall-browse-list">
                {notes.map((note) => {
                  const isPhoto = note.kind === 'photo' && note.src
                  const open = openId === note.id
                  return (
                    <li key={note.id} className="wall-browse-item">
                      {isPhoto ? (
                        <button
                          type="button"
                          className="wall-browse-photo"
                          onClick={() => setLightbox(note)}
                        >
                          <WallPhoto
                            src={note.src}
                            previewUrl={previewUrls[note.id]}
                            alt={note.text}
                          />
                          <span className="wall-browse-meta">
                            <span className="font-hand text-lg text-[var(--cork-ink)]">
                              {note.text || '照片'}
                            </span>
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`wall-browse-note sticky-${note.tone}`}
                          onClick={() =>
                            setOpenId(open ? null : note.id)
                          }
                        >
                          <span className="font-hand text-xl text-[var(--cork-ink)]">
                            {note.text}
                          </span>
                          {open && note.detail ? (
                            <span className="mt-3 block border-t border-black/10 pt-2 text-left text-sm leading-relaxed text-[var(--cork-ink-soft)]">
                              {note.detail}
                            </span>
                          ) : null}
                          {open && enabled ? (
                            <span className="mt-3 flex gap-3">
                              <span
                                role="button"
                                tabIndex={0}
                                className="text-xs text-[var(--leaf)] underline"
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
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : (
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
                return (
                  <div
                    key={note.id}
                    className={[
                      'sticky-slot absolute',
                      isDragging ? 'is-dragging z-30' : 'z-[1] hover:z-20',
                      enabled && allowDrag ? 'can-drag' : '',
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
                        // 电脑墙面由拖拽的 pointerup 打开，避免点一次开关两次
                        if (enabled && allowDrag) {
                          e.preventDefault()
                          return
                        }
                        onPinClick(note)
                      }}
                    >
                      <span className="sticky-pin" aria-hidden />
                      {isPhoto ? (
                        <>
                          <WallPhoto
                            src={note.src}
                            previewUrl={previewUrls[note.id]}
                            alt={note.text}
                          />
                          {note.text ? (
                            <span className="sticky-photo-caption font-hand">
                              {note.text}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <span className="font-hand text-[0.95rem] leading-none text-[var(--cork-ink)] sm:text-xl">
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
        )}

        {error ? (
          <p className="mt-3 text-center text-sm text-red-700">{error}</p>
        ) : null}
      </section>

      {draft ? (
        <div
          className="draft-overlay"
          onPointerDown={(e) => {
            draftBackdropDown.current = e.target === e.currentTarget
          }}
          onPointerUp={(e) => {
            // 点边上失焦：编辑中自动保存；新建则取消
            if (
              draftBackdropDown.current &&
              e.target === e.currentTarget &&
              !busy
            ) {
              if (draftRef.current?.id) void submitDraft()
              else setDraft(null)
            }
            draftBackdropDown.current = false
          }}
        >
          <div
            className="draft-sheet"
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
              {draft.id
                ? '改完点旁边空白处即可保存。'
                : draft.mode === 'photo'
                  ? '标题可选；可一次选多张，会按顺序钉上墙。'
                  : '写一句，钉上墙。'}
            </p>

            <label className="mt-5 block text-xs text-[var(--ink-soft)]">
              {draft.mode === 'photo' ? '标题（可选，多张时只给第一张）' : '便利贴上的字'}
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
                  className="mt-1 w-full resize-none border border-[var(--leaf)]/25 bg-white/70 px-3 py-2 text-base outline-none focus:border-[var(--leaf)]"
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
              {!draft.id ? (
                draft.mode === 'photo' ? (
                  <label
                    className={[
                      'bg-[var(--leaf)] px-4 py-2 text-sm text-[var(--foam)]',
                      busy ? 'pointer-events-none opacity-50' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    {busy ? '钉着…' : '选图片钉上'}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      disabled={busy}
                      onChange={(e) => {
                        const picked = e.target.files
                        if (picked?.length) {
                          void pinPhotoFiles(Array.from(picked))
                        }
                      }}
                    />
                  </label>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitDraft()}
                    className="bg-[var(--leaf)] px-4 py-2 text-sm text-[var(--foam)] disabled:opacity-50"
                  >
                    {busy ? '钉着…' : '钉上墙'}
                  </button>
                )
              ) : (
                <span className="px-2 py-2 text-xs text-[var(--ink-soft)]">
                  {busy ? '保存中…' : '点外侧保存'}
                </span>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {lightbox
        ? createPortal(
            <div className="photo-lightbox">
          <button
            type="button"
            className="photo-lightbox-dim"
            aria-label="关闭"
            onClick={() => setLightbox(null)}
          />
          <div className="photo-lightbox-stage">
            <img
              src={previewUrls[lightbox.id] || assetUrl(lightbox.src)}
              alt={lightbox.text}
              className="photo-lightbox-img"
              decoding="async"
              draggable={false}
            />
            <p className="photo-lightbox-title font-hand">{lightbox.text}</p>
            {lightbox.detail ? (
              <p className="photo-lightbox-detail">{lightbox.detail}</p>
            ) : null}
          </div>

          <div className="photo-lightbox-bar">
            {visiblePhotos.length > 1 ? (
              <div className="photo-lightbox-nav">
                <button type="button" onClick={() => stepLightbox(-1)}>
                  上一张
                </button>
                <span>
                  {Math.max(
                    1,
                    visiblePhotos.findIndex((p) => p.id === lightbox.id) + 1,
                  )}
                  /{visiblePhotos.length}
                </span>
                <button type="button" onClick={() => stepLightbox(1)}>
                  下一张
                </button>
              </div>
            ) : null}
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
        </div>,
            document.body,
          )
        : null}
    </div>
  )
}
