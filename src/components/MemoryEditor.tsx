import { useMemo, useState } from 'react'
import {
  createMemory,
  deleteMemory,
  saveMemory,
  savePhotos,
  uploadPhoto,
  type MemoryInput,
} from '../lib/editApi'
import type { Memory, MemoryKind } from '../lib/memories'
import { getExtras, photosForSlug, type Photo } from '../lib/photos'

const fieldClass =
  'mt-1 w-full border border-[var(--leaf)]/25 bg-white/70 px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--leaf)]'
const labelClass = 'block text-xs tracking-wider text-[var(--ink-soft)]'

type Props = {
  mode: 'edit' | 'create'
  initial?: Partial<Memory>
  onCancel: () => void
  onSaved: (slug: string) => void
  onDeleted?: () => void
}

export function MemoryEditor({ mode, initial, onCancel, onSaved, onDeleted }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10))
  const [place, setPlace] = useState(initial?.place ?? '')
  const [mood, setMood] = useState(initial?.mood ?? '')
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '))
  const [cover, setCover] = useState(initial?.cover ?? '')
  const [kind, setKind] = useState<MemoryKind>(initial?.kind ?? 'event')
  const [body, setBody] = useState(initial?.body ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const existingPhotos = useMemo(
    () => (initial?.slug ? photosForSlug(initial.slug) : []),
    [initial?.slug],
  )
  const [pendingPhotos, setPendingPhotos] = useState<Photo[]>([])
  const shownPhotos = useMemo(() => {
    const map = new Map<string, Photo>()
    for (const photo of existingPhotos) map.set(photo.src, photo)
    for (const photo of pendingPhotos) map.set(photo.src, photo)
    if (cover && !map.has(cover)) {
      map.set(cover, { src: cover, title: '封面', date, slug: initial?.slug })
    }
    return [...map.values()]
  }, [cover, date, existingPhotos, initial?.slug, pendingPhotos])

  async function linkPhotosToSlug(slug: string, list: Photo[]) {
    if (list.length === 0) return
    const extras = getExtras()
    const bySrc = new Map(extras.map((item) => [item.src, item]))
    for (const photo of list) {
      bySrc.set(photo.src, {
        src: photo.src,
        title: photo.title || title || '照片',
        date: photo.date || date,
        slug,
      })
    }
    await savePhotos([...bySrc.values()])
  }

  async function handleAddPhoto(file: File | null) {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const result = await uploadPhoto(file)
      const photo: Photo = {
        src: result.src,
        title: title.trim() || result.title,
        date,
        slug: initial?.slug,
      }
      if (initial?.slug) {
        await linkPhotosToSlug(initial.slug, [photo])
      } else {
        setPendingPhotos((prev) => [...prev.filter((p) => p.src !== photo.src), photo])
      }
      setCover((prev) => prev || result.src)
      setPendingPhotos((prev) => [...prev.filter((p) => p.src !== photo.src), photo])
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    const payload: MemoryInput = {
      title: title.trim() || '未命名',
      date,
      place: place.trim(),
      mood: mood.trim(),
      tags: tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
      cover: cover.trim(),
      kind,
      body,
    }
    try {
      if (mode === 'edit' && initial?.slug) {
        await saveMemory(initial.slug, payload)
        if (pendingPhotos.length > 0) {
          await linkPhotosToSlug(initial.slug, pendingPhotos)
        }
        onSaved(initial.slug)
      } else {
        const result = await createMemory(payload)
        if (pendingPhotos.length > 0 || cover) {
          const toLink = [
            ...pendingPhotos,
            ...(cover ? [{ src: cover, title: title.trim() || '封面', date }] : []),
          ]
          await linkPhotosToSlug(result.slug, toLink)
        }
        onSaved(result.slug)
      }
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!initial?.slug) return
    if (
      !window.confirm(
        `确定删除这条记录？\n${title || initial.slug}\n\n会删除 memories/ 里的 Markdown，照片文件保留。`,
      )
    ) {
      return
    }
    setSaving(true)
    setError('')
    try {
      await deleteMemory(initial.slug)
      onDeleted?.()
      window.location.href = '#/milestones'
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
      setSaving(false)
    }
  }

  return (
    <div className="mt-8 space-y-4 rounded border border-[var(--leaf)]/20 bg-white/50 p-4 sm:p-5">
      <h2 className="font-display text-2xl text-[var(--ink)]">
        {mode === 'edit' ? '编辑回忆' : '新建回忆'}
      </h2>
      <label className={labelClass}>
        标题
        <input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          日期
          <input
            type="date"
            className={fieldClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className={labelClass}>
          地点
          <input className={fieldClass} value={place} onChange={(e) => setPlace(e.target.value)} />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          心情
          <input className={fieldClass} value={mood} onChange={(e) => setMood(e.target.value)} />
        </label>
        <label className={labelClass}>
          标签（逗号分隔）
          <input className={fieldClass} value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
      </div>
      <label className={labelClass}>
        类型
        <select
          className={fieldClass}
          value={kind}
          onChange={(e) => setKind(e.target.value as MemoryKind)}
        >
          <option value="milestone">里程碑（会反复想起的转折）</option>
          <option value="place">地方（有意义的地点）</option>
          <option value="impression">印象（心里的样子）</option>
          <option value="event">归档（日常琐碎）</option>
        </select>
      </label>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={labelClass}>照片</p>
          <label className="cursor-pointer border border-[var(--leaf)]/35 px-3 py-1.5 text-sm text-[var(--leaf)]">
            {uploading ? '上传中…' : '添加照片'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading || saving}
              onChange={(e) => {
                void handleAddPhoto(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        {shownPhotos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {shownPhotos.map((photo) => (
              <button
                key={photo.src}
                type="button"
                className={`overflow-hidden border-2 text-left ${
                  photo.src === cover ? 'border-[var(--leaf)]' : 'border-transparent'
                }`}
                onClick={() => setCover(photo.src)}
                title="点选设为封面"
              >
                <img src={photo.src} alt={photo.title} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--ink-soft)]">还没有照片，点「添加照片」上传。</p>
        )}
        {cover ? (
          <p className="text-xs text-[var(--ink-soft)]">
            当前封面：<code className="text-[var(--leaf)]">{cover}</code>（点缩略图可切换）
          </p>
        ) : null}
      </div>

      <label className={labelClass}>
        正文
        <textarea
          className={`${fieldClass} min-h-40 font-normal leading-relaxed`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={saving || uploading}
          onClick={handleSave}
          className="bg-[var(--leaf)] px-4 py-2 text-sm text-[var(--foam)] disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存到本地文件'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border border-[var(--leaf)]/35 px-4 py-2 text-sm text-[var(--leaf)]"
        >
          取消
        </button>
        {mode === 'edit' && initial?.slug ? (
          <button
            type="button"
            disabled={saving}
            onClick={handleDelete}
            className="ml-auto border border-red-700/40 px-4 py-2 text-sm text-red-800 disabled:opacity-60"
          >
            删除
          </button>
        ) : null}
      </div>
      <p className="text-xs text-[var(--ink-soft)]">
        仅在 <code className="text-[var(--leaf)]">npm run dev</code> 本地开发时可用，会直接改
        memories/ 与 photos/。
      </p>
    </div>
  )
}
