import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { deletePhoto, saveMemory, savePhotos, uploadPhoto } from '../lib/editApi'
import { useEditMode } from '../lib/editContext'
import { getMemory, memories } from '../lib/memories'
import { getExtras, photos, type Photo } from '../lib/photos'

const fieldClass =
  'mt-1 w-full border border-[var(--leaf)]/25 bg-white/80 px-3 py-2 text-sm outline-none focus:border-[var(--leaf)]'

export function PhotosPage() {
  const { enabled } = useEditMode()
  const [lightbox, setLightbox] = useState<Photo | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Photo | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const editPanelRef = useRef<HTMLDivElement>(null)

  const memoryOptions = useMemo(
    () => memories.map((m) => ({ slug: m.slug, label: `${m.date} · ${m.title}` })),
    [],
  )

  useEffect(() => {
    if (!editing || !draft) return
    const id = window.requestAnimationFrame(() => {
      editPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [editing, draft?.src])

  function openEdit(photo: Photo) {
    setLightbox(null)
    setDraft({ ...photo })
    setEditing(true)
    setMessage('')
    setError('')
  }

  async function handleSavePhoto() {
    if (!draft) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const extras = getExtras().map((item) =>
        item.src === draft.src
          ? {
              src: draft.src,
              title: draft.title,
              date: draft.date || undefined,
              slug: draft.slug || undefined,
            }
          : item,
      )
      const exists = extras.some((item) => item.src === draft.src)
      const nextExtras = exists
        ? extras
        : [
            ...extras,
            {
              src: draft.src,
              title: draft.title,
              date: draft.date || undefined,
              slug: draft.slug || undefined,
            },
          ]
      await savePhotos(nextExtras)

      if (draft.slug) {
        const memory = getMemory(draft.slug)
        if (memory && (!memory.cover || memory.cover === draft.src)) {
          // keep existing cover unless empty
        }
      }
      setMessage('已保存照片信息')
      setEditing(false)
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
      setSaving(false)
    }
  }

  async function handleSetCover() {
    if (!draft?.slug) {
      setError('先选择要挂到的回忆')
      return
    }
    const memory = getMemory(draft.slug)
    if (!memory) {
      setError('找不到这条回忆')
      return
    }
    setSaving(true)
    setError('')
    try {
      const extras = getExtras().map((item) =>
        item.src === draft.src
          ? {
              src: draft.src,
              title: draft.title,
              date: draft.date || memory.date,
              slug: draft.slug,
            }
          : item,
      )
      const exists = extras.some((item) => item.src === draft.src)
      await savePhotos(
        exists
          ? extras
          : [
              ...extras,
              {
                src: draft.src,
                title: draft.title,
                date: draft.date || memory.date,
                slug: draft.slug,
              },
            ],
      )
      await saveMemory(memory.slug, { ...memory, cover: draft.src })
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '设置封面失败')
      setSaving(false)
    }
  }

  async function handleUpload(file: File | null) {
    if (!file) return
    setSaving(true)
    setError('')
    try {
      const result = await uploadPhoto(file)
      setDraft({ src: result.src, title: result.title })
      setEditing(true)
      setMessage(`已上传 ${result.src}，可继续填标题和挂回忆`)
      setSaving(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
      setSaving(false)
    }
  }

  async function handleDeletePhoto() {
    if (!draft) return
    if (
      !window.confirm(
        `确定删除这张照片？\n${draft.title}\n${draft.src}\n\n会从照片墙移除，并删除本机文件。同一张图不会再留副本。`,
      )
    ) {
      return
    }
    setSaving(true)
    setError('')
    try {
      await deletePhoto(draft.src)
      setEditing(false)
      setDraft(null)
      setLightbox(null)
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-5 pb-20 pt-4 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display rise-in text-4xl text-[var(--ink)] sm:text-5xl">照片墙</h1>
          <p className="rise-in rise-in-delay-1 mt-3 max-w-xl text-[var(--ink-soft)]">
            点开看大图；本地开发时可改标题、挂回忆、设封面、删除。
          </p>
        </div>
        {enabled ? (
          <label className="rise-in rise-in-delay-1 cursor-pointer bg-[var(--leaf)] px-4 py-2 text-sm text-[var(--foam)]">
            上传照片
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
            />
          </label>
        ) : null}
      </div>

      {editing && draft ? (
        <div
          ref={editPanelRef}
          className="mt-8 space-y-4 rounded border border-[var(--leaf)]/20 bg-white/55 p-4 sm:p-5"
        >
          <h2 className="font-display text-2xl">编辑照片</h2>
          <img src={draft.src} alt={draft.title} className="max-h-64 w-full object-contain" />
          <label className="block text-xs tracking-wider text-[var(--ink-soft)]">
            标题
            <input
              className={fieldClass}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="block text-xs tracking-wider text-[var(--ink-soft)]">
            日期
            <input
              type="date"
              className={fieldClass}
              value={draft.date ?? ''}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            />
          </label>
          <label className="block text-xs tracking-wider text-[var(--ink-soft)]">
            挂到回忆
            <select
              className={fieldClass}
              value={draft.slug ?? ''}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value || undefined })}
            >
              <option value="">不关联</option>
              {memoryOptions.map((opt) => (
                <option key={opt.slug} value={opt.slug}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {message ? <p className="text-sm text-[var(--leaf)]">{message}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={handleSavePhoto}
              className="bg-[var(--leaf)] px-4 py-2 text-sm text-[var(--foam)] disabled:opacity-60"
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSetCover}
              className="border border-[var(--leaf)]/35 px-4 py-2 text-sm text-[var(--leaf)] disabled:opacity-60"
            >
              设为该回忆封面
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleDeletePhoto}
              className="border border-red-700/40 px-4 py-2 text-sm text-red-800 disabled:opacity-60"
            >
              删除照片
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setDraft(null)
              }}
              className="px-4 py-2 text-sm text-[var(--ink-soft)]"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {photos.length === 0 ? (
        <p className="mt-12 text-[var(--ink-soft)]">还没有照片。</p>
      ) : (
        <div className="mt-12 columns-1 gap-4 sm:columns-2">
          {photos.map((photo, i) => (
            <button
              key={`${photo.src}-${i}`}
              type="button"
              className="rise-in group relative mb-4 block w-full break-inside-avoid overflow-hidden text-left"
              style={{ animationDelay: `${0.06 * i}s` }}
              onClick={() => setLightbox(photo)}
            >
              <img
                src={photo.src}
                alt={photo.title}
                className="w-full object-cover transition duration-500 group-hover:scale-[1.02]"
                loading="lazy"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-4 pb-4 pt-10">
                <h2 className="font-display text-xl text-white">{photo.title}</h2>
                {photo.date ? (
                  <p className="mt-1 text-xs tracking-wider text-white/75">{photo.date}</p>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.title}
          onClick={() => setLightbox(null)}
        >
          <div className="ml-auto flex flex-wrap gap-4 text-sm text-white/80">
            {enabled ? (
              <button
                type="button"
                className="hover:text-white"
                onClick={(e) => {
                  e.stopPropagation()
                  openEdit(lightbox)
                }}
              >
                编辑配对
              </button>
            ) : null}
            {lightbox.slug ? (
              <Link
                to={`/m/${lightbox.slug}?img=${encodeURIComponent(lightbox.src)}`}
                className="hover:text-white"
                onClick={(e) => e.stopPropagation()}
              >
                查看回忆 →
              </Link>
            ) : null}
            <button type="button" className="hover:text-white" onClick={() => setLightbox(null)}>
              关闭
            </button>
          </div>
          <div
            className="flex min-h-0 flex-1 items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightbox.src}
              alt={lightbox.title}
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <p className="mt-3 text-center text-sm text-white/85">
            {lightbox.title}
            {lightbox.date ? ` · ${lightbox.date}` : ''}
          </p>
        </div>
      ) : null}
    </section>
  )
}
