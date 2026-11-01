import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  fetchEditStatus,
  loadStoredEditPassword,
  setEditPassword,
  verifyEditPassword,
  type EditStatus,
} from './editApi'

type EditContextValue = {
  /** 可以改墙 / 上传（本地始终；线上需口令解锁） */
  enabled: boolean
  /** 回忆 Markdown 等仍走本地磁盘，仅本地 dev 开启 */
  canEditMemories: boolean
  ready: boolean
  remote: boolean
  /** 线上 API 可用但尚未输入口令 */
  needsUnlock: boolean
  unlock: (password: string) => Promise<boolean>
  lock: () => void
}

const EditContext = createContext<EditContextValue>({
  enabled: false,
  canEditMemories: false,
  ready: false,
  remote: false,
  needsUnlock: false,
  unlock: async () => false,
  lock: () => undefined,
})

export function EditProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<EditStatus | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const stored = loadStoredEditPassword()

    ;(async () => {
      const next = await fetchEditStatus()
      if (cancelled) return
      setStatus(next)

      if (next.mode === 'local' && next.enabled) {
        setUnlocked(true)
        setReady(true)
        return
      }

      if (next.mode === 'remote' && next.enabled && next.needsPassword && stored) {
        const ok = await verifyEditPassword(stored)
        if (cancelled) return
        setUnlocked(ok)
        if (!ok) setEditPassword('')
      } else if (next.mode === 'remote' && next.enabled && !next.needsPassword) {
        setUnlocked(true)
      }

      if (!cancelled) setReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const unlock = useCallback(async (password: string) => {
    const ok = await verifyEditPassword(password.trim())
    setUnlocked(ok)
    return ok
  }, [])

  const lock = useCallback(() => {
    setEditPassword('')
    setUnlocked(false)
  }, [])

  const value = useMemo<EditContextValue>(() => {
    const remote = status?.mode === 'remote'
    const apiUp = Boolean(status?.enabled)
    const needsUnlock = remote && apiUp && Boolean(status?.needsPassword) && !unlocked
    const enabled =
      remote ? apiUp && (!status?.needsPassword || unlocked) : Boolean(status?.enabled)

    return {
      enabled,
      canEditMemories: enabled && !remote,
      ready,
      remote,
      needsUnlock,
      unlock,
      lock,
    }
  }, [status, unlocked, ready, unlock, lock])

  return <EditContext.Provider value={value}>{children}</EditContext.Provider>
}

export function useEditMode() {
  return useContext(EditContext)
}
