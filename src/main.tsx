import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { promoteOuterRoomParam } from './lib/roomLink'

// 分享常剥 hash：?play=1 / ?room= 拉进小游戏；冷启动 #/games 也开 play-only
promoteOuterRoomParam()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

function hideBootShell() {
  const boot = document.getElementById('boot-shell')
  if (!boot) return
  boot.setAttribute('data-hide', '1')
  window.setTimeout(() => boot.remove(), 400)
}

// 首帧画出导航/墙壳后再收起启动层；字体延后，别和首包抢 4G
requestAnimationFrame(() => {
  requestAnimationFrame(hideBootShell)
})

const loadFonts = () => {
  void import('./fonts.css')
}
if (typeof window.requestIdleCallback === 'function') {
  window.requestIdleCallback(loadFonts, { timeout: 4000 })
} else {
  window.setTimeout(loadFonts, 1200)
}
