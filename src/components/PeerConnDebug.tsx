import { useEffect, useState } from 'react'
import {
  clearPeerLogs,
  formatPeerLogs,
  getPeerLogs,
  subscribePeerLogs,
} from '../lib/peerLog'

/** 长按房间号可展开；方便把连接日志复制出来排查 */
export function PeerConnDebug() {
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    return subscribePeerLogs(() => setTick((n) => n + 1))
  }, [open])

  async function copy() {
    const text = formatPeerLogs() || '(暂无日志)'
    try {
      if (navigator.share) {
        await navigator.share({ title: '房间连接日志', text })
        return
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      window.prompt('复制日志', text)
    }
  }

  const lines = open ? getPeerLogs() : []
  void tick

  return (
    <div className="game-peer-debug">
      <button
        type="button"
        className="game-peer-debug-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '收起连接日志' : '连接日志'}
      </button>
      {open ? (
        <div className="game-peer-debug-panel">
          <pre>
            {lines.length === 0
              ? '暂无日志'
              : lines
                  .map((e) => {
                    const time = new Date(e.t).toISOString().slice(11, 23)
                    return e.detail
                      ? `${time} ${e.msg} | ${e.detail}`
                      : `${time} ${e.msg}`
                  })
                  .join('\n')}
          </pre>
          <div className="flex gap-2">
            <button type="button" className="game-lobby-ghost" onClick={() => void copy()}>
              {copied ? '已复制' : '分享/复制日志'}
            </button>
            <button
              type="button"
              className="game-lobby-ghost"
              onClick={() => {
                clearPeerLogs()
                setTick((n) => n + 1)
              }}
            >
              清空
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
