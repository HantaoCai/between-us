import { Link } from 'react-router-dom'
import { memories } from '../lib/memories'

export function TimelinePage() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 pb-20 pt-4 sm:px-8">
      <h1 className="font-display rise-in text-4xl text-[var(--ink)] sm:text-5xl">时间线</h1>
      <p className="rise-in rise-in-delay-1 mt-3 text-[var(--ink-soft)]">
        每件事对应 <code className="text-[var(--leaf)]">memories/</code> 里的一篇 Markdown。
      </p>

      {memories.length === 0 ? (
        <p className="mt-12 text-[var(--ink-soft)]">还没有回忆。复制 `_template.md` 写第一条吧。</p>
      ) : (
        <ol className="relative mt-12 space-y-0">
          <div
            className="absolute top-2 bottom-2 left-[0.4rem] w-px origin-top bg-[var(--leaf)]/25"
            style={{ animation: 'line-grow 1.1s ease both' }}
          />
          {memories.map((memory, index) => (
            <li
              key={memory.slug}
              className="rise-in relative pl-8 pb-10"
              style={{ animationDelay: `${0.08 * index}s` }}
            >
              <span className="absolute top-1.5 left-0 h-3.5 w-3.5 rounded-full border-2 border-[var(--leaf)] bg-[var(--foam)]" />
              <Link to={`/m/${memory.slug}`} className="group block">
                <time className="text-xs tracking-wider text-[var(--ink-soft)]">
                  {memory.date}
                </time>
                <h2 className="font-display mt-1 text-2xl text-[var(--ink)] transition-colors group-hover:text-[var(--leaf)]">
                  {memory.title}
                </h2>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">
                  {[memory.place, memory.mood].filter(Boolean).join(' · ')}
                </p>
                {memory.tags.length > 0 ? (
                  <p className="mt-2 text-xs text-[var(--night-mist)]">
                    {memory.tags.map((t) => `#${t}`).join('  ')}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
