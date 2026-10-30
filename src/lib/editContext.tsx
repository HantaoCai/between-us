import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { fetchEditStatus } from './editApi'

type EditContextValue = {
  enabled: boolean
  ready: boolean
}

const EditContext = createContext<EditContextValue>({
  enabled: false,
  ready: false,
})

export function EditProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchEditStatus().then((ok) => {
      if (!cancelled) {
        setEnabled(ok)
        setReady(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <EditContext.Provider value={{ enabled, ready }}>{children}</EditContext.Provider>
  )
}

export function useEditMode() {
  return useContext(EditContext)
}
