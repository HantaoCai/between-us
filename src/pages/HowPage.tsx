const tips = [
  {
    title: 'Markdown 第二大脑',
    body: '每件事一篇 memories/*.md。Git 帮你保留每一次修改——哪天改了措辞，历史都在。',
  },
  {
    title: 'GitHub Pages 直接预览',
    body: '和 quant-dashboard 一样：仓库开 Pages 后，对方打开链接就能翻时间线，不必再开阿里云电脑。',
  },
  {
    title: '注意隐私',
    body: '公开仓库谁都能看。亲密内容请用私有仓库；免费账号的私有仓 Pages 可能受限，可改成本地预览或自建静态托管。',
  },
  {
    title: 'U 盘数字博物馆',
    body: '定期把 photos/、memories/ 和构建好的 dist/ 拷进加密 U 盘，几十年后也能离线打开。',
  },
  {
    title: '纪念日与小游戏',
    body: '首页倒数可以改成你们的日期；以后还能加抽签、猜地点之类的小互动，仍然是静态页。',
  },
]

export function HowPage() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 pb-20 pt-4 sm:px-8">
      <h1 className="font-display rise-in text-4xl text-[var(--ink)] sm:text-5xl">怎么用</h1>
      <p className="rise-in rise-in-delay-1 mt-3 text-[var(--ink-soft)]">
        写回忆、推仓库、开 Pages——三步就能给对方一个可以打开的站点。
      </p>

      <ol className="mt-10 space-y-6">
        <li className="rise-in border-l-2 border-[var(--leaf)]/40 pl-4">
          <h2 className="font-display text-xl">1. 写一条回忆</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
            复制 <code className="text-[var(--leaf)]">memories/_template.md</code>，改成{' '}
            <code className="text-[var(--leaf)]">YYYY-MM-DD-标题.md</code>，填 frontmatter 和正文。
          </p>
        </li>
        <li className="rise-in rise-in-delay-1 border-l-2 border-[var(--leaf)]/40 pl-4">
          <h2 className="font-display text-xl">2. 本地看看</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
            <code className="text-[var(--leaf)]">npm install && npm run dev</code>
            ，浏览器打开本地地址即可。
          </p>
        </li>
        <li className="rise-in rise-in-delay-2 border-l-2 border-[var(--leaf)]/40 pl-4">
          <h2 className="font-display text-xl">3. 推到 GitHub Pages</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
            创建 GitHub 仓库后，Settings → Pages → Source 选 GitHub Actions。每次推送 main，工作流会构建并发布；地址一般是{' '}
            <code className="text-[var(--leaf)]">https://你的用户名.github.io/仓库名/</code>。
          </p>
        </li>
      </ol>

      <h2 className="font-display rise-in mt-14 text-3xl text-[var(--ink)]">其他建议</h2>
      <ul className="mt-6 space-y-5">
        {tips.map((tip, i) => (
          <li
            key={tip.title}
            className="rise-in"
            style={{ animationDelay: `${0.08 * i}s` }}
          >
            <h3 className="font-display text-xl text-[var(--leaf)]">{tip.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-[var(--ink-soft)]">{tip.body}</p>
          </li>
        ))}
      </ul>

      <p className="mt-12 text-sm text-[var(--ink-soft)]">
        起点日期在 <code className="text-[var(--leaf)]">src/lib/memories.ts</code> 的{' '}
        <code className="text-[var(--leaf)]">TOGETHER_SINCE</code>，改成你们的那天就行。
      </p>
    </section>
  )
}
