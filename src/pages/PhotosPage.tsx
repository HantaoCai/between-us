const slots = [
  { title: '河边步道', hint: '把照片放到 public/photos/' },
  { title: '街角咖啡馆', hint: '文件名随意，时间线可写 cover' },
  { title: '天台跨年', hint: '私密照片建议用私有仓库' },
  { title: '还没命名的一天', hint: '空位留给下一次出门' },
]

export function PhotosPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-5 pb-20 pt-4 sm:px-8">
      <h1 className="font-display rise-in text-4xl text-[var(--ink)] sm:text-5xl">照片墙</h1>
      <p className="rise-in rise-in-delay-1 mt-3 max-w-xl text-[var(--ink-soft)]">
        先留了位置。把图片放进 <code className="text-[var(--leaf)]">public/photos/</code>
        ，再在回忆的 frontmatter 里写上 <code className="text-[var(--leaf)]">cover</code>。
      </p>

      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {slots.map((slot, i) => (
          <div
            key={slot.title}
            className="rise-in relative flex aspect-[4/3] flex-col justify-end overflow-hidden border border-[var(--leaf)]/15 bg-[linear-gradient(160deg,rgba(63,122,97,0.12),rgba(196,165,116,0.18))] p-5"
            style={{ animationDelay: `${0.1 * i}s` }}
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 30% 40%, rgba(255,255,255,0.35), transparent 45%)',
              }}
            />
            <h2 className="font-display relative text-2xl text-[var(--ink)]">{slot.title}</h2>
            <p className="relative mt-1 text-sm text-[var(--ink-soft)]">{slot.hint}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
