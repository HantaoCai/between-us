import { useEffect, useState } from 'react'
import { assetUrl } from '../lib/assetUrl'

type Props = {
  src: string
  /** 刚上传时的本地预览，优先显示，避免等磁盘/缓存 */
  previewUrl?: string
  alt: string
  className?: string
}

/** 墙上缩略图：优先 blob 预览；失败时带时间戳重试服务器地址 */
export function WallPhoto({ src, previewUrl, alt, className }: Props) {
  const server = assetUrl(src)
  const [current, setCurrent] = useState(previewUrl || server)
  const [tries, setTries] = useState(0)

  useEffect(() => {
    setCurrent(previewUrl || server)
    setTries(0)
  }, [previewUrl, server])

  return (
    <img
      src={current}
      alt={alt}
      className={className}
      loading="eager"
      decoding="async"
      draggable={false}
      onError={() => {
        if (previewUrl && current === previewUrl) {
          // blob 异常时退回服务器地址
          setCurrent(`${server}${server.includes('?') ? '&' : '?'}t=${Date.now()}`)
          setTries(1)
          return
        }
        if (tries >= 4) return
        const next = tries + 1
        setTries(next)
        window.setTimeout(() => {
          setCurrent(`${server}${server.includes('?') ? '&' : '?'}t=${Date.now()}-${next}`)
        }, 80 * next)
      }}
    />
  )
}
