/** 对局中常驻的小「回大厅」，点前确认 */
export function BackToHubButton({
  busy,
  onConfirm,
}: {
  busy?: boolean
  onConfirm: () => void
}) {
  return (
    <div className="game-back-hub-wrap">
      <button
        type="button"
        className="game-back-hub"
        disabled={busy}
        onClick={() => {
          if (busy) return
          if (!window.confirm('确定回大厅选游戏？\n对方也会一起回去。')) return
          onConfirm()
        }}
      >
        {busy ? '返回中…' : '回大厅'}
      </button>
    </div>
  )
}
