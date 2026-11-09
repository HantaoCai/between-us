import { useEffect, useRef, useState } from 'react'
import { assetUrl } from '../lib/assetUrl'
import { photoThumbSrc } from '../lib/photoThumb'
import {
  acquireWallPhotoSlot,
  isWallMediaAllowed,
  subscribeWallMediaAllowed,
} from '../lib/wallPhotoGate'

type Props = {
  src: string
  /** 刚上传时的本地预览，优先显示，避免等磁盘/缓存 */
  previewUrl?: string
  alt: string
  className?: string
  /** 墙面/列表用缩略图；灯箱等大图请传 false */
  thumb?: boolean
  /** 降低非首批墙图优先级，避免抢小游戏 chunk / 导航 */
  priority?: 'high' | 'low' | 'auto'
}

/** 墙上缩略图：等首页放行后再拉；进小游戏会整体停掉。 */
export function WallPhoto({
  src,
  previewUrl,
  alt,
  className,
  thumb = true,
  priority = 'auto',
}: Props) {
  const full = assetUrl(src)
  const preferred = thumb ? assetUrl(photoThumbSrc(src)) || full : full
  const [allowed, setAllowed] = useState(isWallMediaAllowed)
  const [current, setCurrent] = useState(previewUrl || '')
  const [phase, setPhase] = useState<'preview' | 'thumb' | 'full' | 'retry' | 'wait'>(
    previewUrl ? 'preview' : 'wait',
  )
  const [tries, setTries] = useState(0)
  const [shown, setShown] = useState(Boolean(previewUrl))
  const releaseRef = useRef<(() => void) | null>(null)

  const releaseSlot = () => {
    releaseRef.current?.()
    releaseRef.current = null
  }

  useEffect(() => subscribeWallMediaAllowed(setAllowed), [])

  useEffect(() => {
    let cancelled = false

    setTries(0)
    releaseSlot()

    if (previewUrl) {
      setCurrent(previewUrl)
      setPhase('preview')
      setShown(true)
      return () => {
        cancelled = true
      }
    }

    if (!allowed) {
      setCurrent('')
      setPhase('wait')
      setShown(false)
      return () => {
        cancelled = true
      }
    }

    setCurrent('')
    setPhase('wait')
    setShown(false)

    void (async () => {
      const release = await acquireWallPhotoSlot(priority)
      if (cancelled || !isWallMediaAllowed()) {
        release()
        return
      }
      releaseRef.current = release
      setCurrent(preferred)
      setPhase(thumb ? 'thumb' : 'full')
    })()

    return () => {
      cancelled = true
      releaseSlot()
    }
  }, [previewUrl, preferred, thumb, priority, allowed])

  return (
    <img
      src={current || undefined}
      alt={alt}
      className={className}
      style={{ opacity: shown ? 1 : 0 }}
      loading={thumb ? 'eager' : 'lazy'}
      fetchPriority={priority}
      decoding="async"
      draggable={false}
      onLoad={() => {
        setShown(true)
        releaseSlot()
      }}
      onError={() => {
        setShown(false)
        if (phase === 'preview' && previewUrl) {
          setCurrent(preferred)
          setPhase(thumb ? 'thumb' : 'full')
          return
        }
        if (phase === 'thumb' && preferred !== full) {
          setCurrent(full)
          setPhase('full')
          return
        }
        if (tries >= 4 || phase === 'wait') {
          releaseSlot()
          return
        }
        const next = tries + 1
        setTries(next)
        setPhase('retry')
        window.setTimeout(() => {
          setCurrent(`${full}${full.includes('?') ? '&' : '?'}t=${Date.now()}-${next}`)
        }, 80 * next)
      }}
    />
  )
}
