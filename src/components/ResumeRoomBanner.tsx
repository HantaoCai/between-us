import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { aboutLabel } from '../lib/notes'
import {
  clearPeerRoom,
  peerGamePath,
  peerGameTitle,
  readPeerRoom,
  type SavedPeerRoom,
} from '../lib/peerRoomSave'

export function ResumeRoomBanner() {
  const { pathname } = useLocation()
  const [saved, setSaved] = useState<SavedPeerRoom | null>(() => readPeerRoom())

  useEffect(() => {
    function sync() {
      setSaved(readPeerRoom())
    }
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener('pageshow', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('pageshow', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [pathname])

  if (!saved) return null

  // 已经在对应游戏页里，由页面自己自动重连，避免顶栏再挡一层
  const onThatGame =
    pathname === peerGamePath(saved.game) ||
    pathname === `${peerGamePath(saved.game)}/`

  if (onThatGame) return null

  function abandon() {
    clearPeerRoom()
    setSaved(null)
  }

  return (
    <div className="game-resume-bar">
      <div className="game-resume mx-auto w-full max-w-lg">
        <div>
          <p className="text-xs tracking-[0.18em] text-[var(--leaf)]">
            {saved.game === 'hub' ? '回到房间' : '继续对局'}
          </p>
          <p className="mt-1 text-sm text-[var(--ink)]">
            {peerGameTitle(saved.game)} · 房间 {saved.code}
          </p>
          <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
            你是{aboutLabel(saved.who)} · {saved.role === 'host' ? '开房方' : '加入方'}
          </p>
        </div>
        <div className="game-resume-actions">
          <Link
            to={`${peerGamePath(saved.game)}?resume=1`}
            className="game-resume-go"
          >
            继续
          </Link>
          <button type="button" className="game-resume-drop" onClick={abandon}>
            放弃
          </button>
        </div>
      </div>
    </div>
  )
}
