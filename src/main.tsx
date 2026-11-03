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
