import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { roomShareUrl } from '../lib/roomLink'

type Props = {
  code: string
  disabled?: boolean
}

export function RoomInvite({ code, disabled }: Props) {
  const [qr, setQr] = useState('')
  const [hint, setHint] = useState('')
  const link = roomShareUrl(code)
  const canShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    let cancelled = false
    setQr('')
    void QRCode.toDataURL(link, {
      width: 220,
      margin: 1,
      color: { dark: '#2a2218', light: '#00000000' },
      errorCorrectionLevel: 'M',
    }).then((url) => {
      if (!cancelled) setQr(url)
    })
    return () => {
      cancelled = true
    }
  }, [link])

  async function share() {
    if (disabled || !code) return
    setHint('')
    if (!canShare) {
      setHint('让对方扫上面的码')
      return
    }
    try {
      await navigator.share({
        title: '一起来玩',
        text: '打开这个链接，进同一间房',
        url: link,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (err instanceof Error && err.name === 'AbortError') return
      setHint('分享取消了，也可让对方扫码')
    }
  }

  return (
    <div className="game-invite">
      <p className="game-invite-label">让对方扫这个码进房</p>
      <div className="game-invite-qr">
        {qr ? (
          <img src={qr} alt="房间二维码" width={220} height={220} />
        ) : (
          <span className="text-sm text-[var(--ink-soft)]">生成二维码…</span>
        )}
      </div>
      {canShare ? (
        <button
          type="button"
          className="game-lobby-primary w-full"
          disabled={disabled || !code}
          onClick={() => void share()}
        >
          发给对方
        </button>
      ) : null}
      {hint ? <p className="text-xs text-[var(--ink-soft)]">{hint}</p> : null}
    </div>
  )
}
