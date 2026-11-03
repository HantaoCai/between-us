/** 对局页顶栏：旁观上帝视角提示 */
export function SpectatorBanner({ detail }: { detail?: string }) {
  return (
    <p
      className="rounded-lg bg-[var(--leaf)]/10 px-3 py-2 text-center text-xs text-[var(--leaf)]"
      role="status"
    >
      旁观 · 上帝视角
      {detail ? ` · ${detail}` : ' · 只看不玩'}
    </p>
  )
}
