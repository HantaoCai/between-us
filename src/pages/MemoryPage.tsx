import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { MemoryEditor } from '../components/MemoryEditor'
import { useEditMode } from '../lib/editContext'
import { renderMarkdown } from '../lib/markdown'
import { getMemory, kindLabel } from '../lib/memories'
import { photosForSlug } from '../lib/photos'

export function MemoryPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { enabled } = useEditMode()
  const [editing, setEditing] = useState(searchParams.get('edit') === '1')
  const memory = getMemory(slug)

  useEffect(() => {
    if (searchParams.get('edit') === '1' && enabled) {
      setEditing(true)
    }
  }, [enabled, searchParams])
  const related = photosForSlug(slug)
  const imgParam = searchParams.get('img')
  const hero =
    (imgParam && related.some((p) => p.src === imgParam) ? imgParam : null) ||
    (imgParam && memory?.cover === imgParam ? imgParam : null) ||
    memory?.cover ||
    related[0]?.src ||
    ''

  if (!memory) {
    return (
      <section className="mx-auto w-full max-w-2xl px-5 py-16 text-center sm:px-8">
        <h1 className="font-display text-3xl">没有找到这条回忆</h1>
        <p className="mt-3 text-[var(--ink-soft)]">也许文件名改了，或者还没写进 memories/。</p>
        <Link to="/milestones" className="mt-8 inline-block text-[var(--leaf)]">
          返回里程碑
        </Link>
      </section>
    )
  }

  return (
    <article className="mx-auto w-full max-w-2xl px-5 pb-20 pt-4 sm:px-8">
      <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--ink-soft)]">
        <Link
          to={
            memory.kind === 'milestone'
              ? '/milestones'
              : memory.kind === 'place'
                ? '/places'
                : memory.kind === 'impression'
                  ? '/impressions'
                  : '/archive'
          }
          className="transition hover:text-[var(--leaf)]"
        >
          ← {kindLabel(memory.kind)}
        </Link>
        <Link to="/photos" className="transition hover:text-[var(--leaf)]">
          照片
        </Link>
        {enabled && !editing ? (
          <button
            type="button"
            className="ml-auto text-[var(--leaf)] transition hover:text-[var(--leaf-bright)]"
            onClick={() => setEditing(true)}
          >
            编辑 / 删除
          </button>
        ) : null}
      </div>

      {editing ? (
        <MemoryEditor
          mode="edit"
          initial={memory}
          onCancel={() => setEditing(false)}
          onSaved={(nextSlug) => {
            setEditing(false)
            if (nextSlug !== slug) navigate(`/m/${nextSlug}`)
          }}
          onDeleted={() =>
            navigate(
              memory.kind === 'milestone'
                ? '/milestones'
                : memory.kind === 'place'
                  ? '/places'
                  : memory.kind === 'impression'
                    ? '/impressions'
                    : '/archive',
            )
          }
        />
      ) : (
        <>
          <header className="rise-in mt-6">
            <p className="text-xs tracking-wider text-[var(--ink-soft)]">
              {kindLabel(memory.kind)}
              {memory.kind === 'impression' ? ` · 写于 ${memory.date}` : ` · ${memory.date}`}
            </p>
            <h1 className="font-display mt-2 text-4xl text-[var(--ink)] sm:text-5xl">
              {memory.title}
            </h1>
            <p className="mt-3 text-sm text-[var(--ink-soft)]">
              {[memory.place, memory.mood].filter(Boolean).join(' · ')}
            </p>
            {memory.tags.length > 0 ? (
              <p className="mt-2 text-xs text-[var(--night-mist)]">
                {memory.tags.map((t) => `#${t}`).join('  ')}
              </p>
            ) : null}
          </header>
          {hero ? (
            <img
              src={hero}
              alt={memory.title}
              className="rise-in rise-in-delay-1 mt-8 w-full object-cover"
              loading="lazy"
            />
          ) : null}
          {related.length > 1 ? (
            <div className="rise-in rise-in-delay-1 mt-4 grid grid-cols-4 gap-2 sm:grid-cols-5">
              {related.map((photo) => (
                <button
                  key={photo.src}
                  type="button"
                  className={`overflow-hidden border-2 ${
                    photo.src === hero ? 'border-[var(--leaf)]' : 'border-transparent opacity-80'
                  }`}
                  onClick={() => setSearchParams({ img: photo.src })}
                  aria-label={photo.title}
                >
                  <img
                    src={photo.src}
                    alt={photo.title}
                    className="aspect-square w-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
          <div
            className="prose-memory rise-in rise-in-delay-2 mt-10 text-base"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(memory.body) }}
          />
        </>
      )}
    </article>
  )
}
