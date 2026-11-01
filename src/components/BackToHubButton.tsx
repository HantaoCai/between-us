/** 对局中左下角固定「回大厅」：只自己回，不弹框、不拉对方 */
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
          onConfirm()
        }}
      >
        {busy ? '返回中…' : '回大厅'}
      </button>
    </div>
  )
}
