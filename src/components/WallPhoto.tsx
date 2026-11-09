import { useEffect, useRef, useState } from 'react'
import { assetUrl } from '../lib/assetUrl'
import { photoThumbSrc } from '../lib/photoThumb'
import { acquireWallPhotoSlot } from '../lib/wallPhotoGate'

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

/** 墙上缩略图：优先 blob 预览，再 thumbs；失败回退原图。加载成功前透明，避免 Safari 裂图问号。 */
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

  useEffect(() => {
    let cancelled = false

    setTries(0)
    setShown(false)
    releaseSlot()

    if (previewUrl) {
      setCurrent(previewUrl)
      setPhase('preview')
      setShown(true)
      return () => {
        cancelled = true
      }
    }

    // 先不挂 src，等并发闸放行，避免整墙一起打满带宽
    setCurrent('')
    setPhase('wait')

    void (async () => {
      const release = await acquireWallPhotoSlot(priority)
      if (cancelled) {
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
  }, [previewUrl, preferred, thumb, priority])

  return (
    <img
      src={current || undefined}
      alt={alt}
      className={className}
      style={{ opacity: shown ? 1 : 0 }}
      // 墙面在 overflow+transform 里，lazy 在部分 iOS 上会一直白块；用闸门代替全量 eager
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
