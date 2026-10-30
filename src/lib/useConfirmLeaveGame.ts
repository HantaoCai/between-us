import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

/** 联机对局进行中：拦导航 / 刷新，取消后可继续留在本页 */
export function useConfirmLeaveGame(when: boolean) {
  const blocker = useBlocker(when)

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    const leave = window.confirm('对局还在进行，离开会断开连接。确定离开？')
    if (leave) blocker.proceed()
    else blocker.reset()
  }, [blocker])

  useEffect(() => {
    if (!when) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [when])
}
