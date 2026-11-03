import { Navigate } from 'react-router-dom'
import { isPlayOnly } from '../lib/roomLink'

/** 旧路径 / 通配：play-only 回大厅，否则回拾光（或指定兜底） */
export function PlayOnlyFallback({ to = '/' }: { to?: string }) {
  return <Navigate to={isPlayOnly() ? '/games' : to} replace />
}
