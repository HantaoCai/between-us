import { Link } from 'react-router-dom'
import { DaysTogether } from '../components/DaysTogether'
import { memories } from '../lib/memories'

export function HomePage() {
  const latest = memories[0]

  return (
    <div>
      <section className="relative mx-auto flex min-h-[calc(100svh-5.5rem)] w-full max-w-5xl flex-col justify-center px-5 pb-16 pt-6 sm:px-8">
        <div className="soft-float pointer-events-none absolute right-[-10%] top-[12%] h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(63,122,97,0.25),transparent_70%)] sm:right-[5%] sm:h-72 sm:w-72" />
        <div className="pointer-events-none absolute bottom-[18%] left-[-8%] h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(196,165,116,0.28),transparent_70%)]" />

        <p className="rise-in text-sm tracking-[0.25em] text-[var(--leaf)]">SHUANGREN JI</p>
        <h1 className="rise-in rise-in-delay-1 font-display mt-4 max-w-xl text-6xl leading-[1.05] text-[var(--ink)] sm:text-7xl md:text-8xl">
          双人记
        </h1>
        <p className="rise-in rise-in-delay-2 mt-6 max-w-md text-base leading-relaxed text-[var(--ink-soft)] sm:text-lg">
          把散步、雨天咖啡和跨年夜写进仓库。Markdown 存档，网页翻阅——和 quant-dashboard
          一样，推到 GitHub Pages 就能打开。
        </p>

        <div className="rise-in rise-in-delay-3 mt-10 flex flex-col gap-8 sm:flex-row sm:items-end sm:gap-12">
          <DaysTogether />
          <div className="flex flex-wrap gap-3">
            <Link
              to="/timeline"
              className="bg-[var(--leaf)] px-5 py-3 text-sm text-[var(--foam)] transition hover:bg-[var(--leaf-bright)]"
            >
              翻开时间线
            </Link>
            <Link
              to="/how"
              className="border border-[var(--leaf)]/35 px-5 py-3 text-sm text-[var(--leaf)] transition hover:border-[var(--leaf)] hover:bg-white/40"
            >
              怎么记录
            </Link>
          </div>
        </div>

        {latest ? (
          <Link
            to={`/m/${latest.slug}`}
            className="rise-in rise-in-delay-3 mt-14 block max-w-lg border-t border-[var(--leaf)]/20 pt-6 transition hover:border-[var(--leaf)]/50"
          >
            <span className="text-xs tracking-widest text-[var(--ink-soft)]">最近一条</span>
            <span className="font-display mt-2 block text-2xl text-[var(--ink)]">
              {latest.title}
            </span>
            <span className="mt-1 block text-sm text-[var(--ink-soft)]">
              {latest.date}
              {latest.place ? ` · ${latest.place}` : ''}
            </span>
          </Link>
        ) : null}
      </section>
    </div>
  )
}
