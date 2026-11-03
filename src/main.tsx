import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { promoteOuterRoomParam } from './lib/roomLink'

// 分享链接常被剥掉 hash；先把外层 ?room= 迁进 #/games，再挂路由
promoteOuterRoomParam()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
