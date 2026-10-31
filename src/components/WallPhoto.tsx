import { useEffect, useState } from 'react'
import { assetUrl } from '../lib/assetUrl'
import { photoThumbSrc } from '../lib/photoThumb'

type Props = {
  src: string
  /** 刚上传时的本地预览，优先显示，避免等磁盘/缓存 */
  previewUrl?: string
  alt: string
  className?: string
  /** 墙面/列表用缩略图；灯箱等大图请传 false */
  thumb?: boolean
}

/** 墙上缩略图：优先 blob 预览，再 thumbs；失败回退原图 */
export function WallPhoto({
  src,
  previewUrl,
  alt,
  className,
  thumb = true,
}: Props) {
  const full = assetUrl(src)
  const preferred = thumb ? assetUrl(photoThumbSrc(src)) || full : full
  const [current, setCurrent] = useState(previewUrl || preferred)
  const [phase, setPhase] = useState<'preview' | 'thumb' | 'full' | 'retry'>(
    previewUrl ? 'preview' : thumb ? 'thumb' : 'full',
  )
  const [tries, setTries] = useState(0)

  useEffect(() => {
    setCurrent(previewUrl || preferred)
    setPhase(previewUrl ? 'preview' : thumb ? 'thumb' : 'full')
    setTries(0)
  }, [previewUrl, preferred, thumb])

  return (
    <img
      src={current}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => {
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
        if (tries >= 4) return
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
