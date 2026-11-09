import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchEditStatus, verifyEditAuth } from './editApi'
import {
  clearSessionEditToken,
  readSessionEditToken,
  writeSessionEditToken,
} from './proxyConfig'

type EditContextValue = {
  /** 有编辑后端（可拉墙 / 具备写能力） */
  available: boolean
  /** 已解锁，可钉 / 取下 / 改 */
  enabled: boolean
  ready: boolean
  authRequired: boolean
  unlock: (token?: string) => Promise<void>
  lock: () => void
}

const EditContext = createContext<EditContextValue>({
  available: false,
  enabled: false,
  ready: false,
  authRequired: false,
  unlock: async () => {},
  lock: () => {},
})

export function EditProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [ready, setReady] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const status = await fetchEditStatus(true)
        if (cancelled) return
        setAvailable(status.available)
        setAuthRequired(status.authRequired)

        if (!status.available) {
          setEnabled(false)
          return
        }
        // 本机 Vite 编辑插件：无需口令
        if (status.backend === 'local') {
          setEnabled(true)
          return
        }
        // 云端：恢复本会话已验证的口令
        const saved = readSessionEditToken()
        if (!saved) {
          setEnabled(false)
          return
        }
        try {
          await verifyEditAuth(saved)
          if (!cancelled) setEnabled(true)
        } catch {
          clearSessionEditToken()
          if (!cancelled) setEnabled(false)
        }
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const unlock = useCallback(async (token = '') => {
    const status = await fetchEditStatus()
    if (!status.available) {
      throw new Error('无编辑后端')
    }
    if (status.backend === 'local') {
      setEnabled(true)
      return
    }
    const trimmed = token.trim()
    await verifyEditAuth(trimmed)
    writeSessionEditToken(trimmed)
    setAuthRequired(status.authRequired)
    setAvailable(true)
    setEnabled(true)
  }, [])

  const lock = useCallback(() => {
    clearSessionEditToken()
    setEnabled(false)
  }, [])

  const value = useMemo(
    () => ({ available, enabled, ready, authRequired, unlock, lock }),
    [available, enabled, ready, authRequired, unlock, lock],
  )

  return <EditContext.Provider value={value}>{children}</EditContext.Provider>
}

export function useEditMode() {
  return useContext(EditContext)
}
