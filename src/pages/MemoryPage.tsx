import { Link, useParams } from 'react-router-dom'
import { renderMarkdown } from '../lib/markdown'
import { getMemory } from '../lib/memories'

export function MemoryPage() {
  const { slug = '' } = useParams()
  const memory = getMemory(slug)

  if (!memory) {
    return (
      <section className="mx-auto w-full max-w-2xl px-5 py-16 text-center sm:px-8">
        <h1 className="font-display text-3xl">没有找到这条回忆</h1>
        <p className="mt-3 text-[var(--ink-soft)]">也许文件名改了，或者还没写进 memories/。</p>
        <Link to="/timeline" className="mt-8 inline-block text-[var(--leaf)]">
          返回时间线
        </Link>
      </section>
    )
  }

  return (
    <article className="mx-auto w-full max-w-2xl px-5 pb-20 pt-4 sm:px-8">
      <Link to="/timeline" className="text-sm text-[var(--ink-soft)] transition hover:text-[var(--leaf)]">
        ← 时间线
      </Link>
      <header className="rise-in mt-6">
        <time className="text-xs tracking-wider text-[var(--ink-soft)]">{memory.date}</time>
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
      <div
        className="prose-memory rise-in rise-in-delay-1 mt-10 text-base"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(memory.body) }}
      />
    </article>
  )
}
