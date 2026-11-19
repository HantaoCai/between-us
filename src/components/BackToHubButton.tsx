import { useEffect, useRef, useState } from 'react'

/** 对局中左下角固定「回大厅」：只自己回，不弹框、不拉对方；可选「同步」兜底互推进度 */
export function BackToHubButton({
  busy,
  onConfirm,
  onSyncState,
  syncBusy,
}: {
  busy?: boolean
  onConfirm: () => void
  /**
   * 手动同步本局进度（连上后互推；未连上由调用方提示）。
   * 返回 false 表示没发出（如未连上），按钮不闪反馈。
   */
  onSyncState?: () => boolean | void
  syncBusy?: boolean
}) {
  const [flash, setFlash] = useState<'idle' | 'busy' | 'done'>('idle')
  const flashTimerRef = useRef(0)

  useEffect(() => {
    return () => window.clearTimeout(flashTimerRef.current)
  }, [])

  const showingBusy = syncBusy || flash === 'busy'
  const syncLabel =
    flash === 'done' ? '已发出' : showingBusy ? '同步中…' : '同步'

  function runSync() {
    if (showingBusy || busy || flash === 'done') return
    const ok = onSyncState?.()
    if (ok === false) return
    window.clearTimeout(flashTimerRef.current)
    setFlash('busy')
    flashTimerRef.current = window.setTimeout(() => {
      setFlash('done')
      flashTimerRef.current = window.setTimeout(() => {
        setFlash('idle')
      }, 700)
    }, 650)
  }

  return (
    <div className="game-back-hub-wrap">
      {onSyncState ? (
        <button
          type="button"
          className={[
            'game-back-hub',
            showingBusy ? 'is-syncing' : '',
            flash === 'done' ? 'is-sync-done' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={showingBusy || busy || flash === 'done'}
          aria-busy={showingBusy || undefined}
          onClick={runSync}
        >
          {syncLabel}
        </button>
      ) : null}
      <button
        type="button"
        className="game-back-hub"
        disabled={busy}
        onClick={() => {
          if (busy) return
          onConfirm()
        }}
      >
        {busy ? '返回中…' : '回大厅'}
      </button>
    </div>
  )
}
