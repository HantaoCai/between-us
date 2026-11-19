/** 对局中左下角固定「回大厅」：只自己回，不弹框、不拉对方；可选「同步」兜底互推进度 */
export function BackToHubButton({
  busy,
  onConfirm,
  onSyncState,
  syncBusy,
}: {
  busy?: boolean
  onConfirm: () => void
  /** 手动同步本局进度（连上后互推；未连上由调用方提示） */
  onSyncState?: () => void
  syncBusy?: boolean
}) {
  return (
    <div className="game-back-hub-wrap">
      {onSyncState ? (
        <button
          type="button"
          className="game-back-hub"
          disabled={syncBusy || busy}
          onClick={() => {
            if (syncBusy || busy) return
            onSyncState()
          }}
        >
          {syncBusy ? '同步中…' : '同步'}
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
