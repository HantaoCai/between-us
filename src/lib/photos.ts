import extrasJson from '../../memories/_photos.json'
import { memories } from './memories'

export type Photo = {
  src: string
  title: string
  date?: string
  slug?: string
}

const extras = extrasJson as Photo[]

/** 按 src 去重：封面和清单指向同一文件时只显示一张 */
function buildPhotos(): Photo[] {
  const bySrc = new Map<string, Photo>()

  for (const memory of memories) {
    if (!memory.cover) continue
    bySrc.set(memory.cover, {
      src: memory.cover,
      title: memory.title,
      date: memory.date,
      slug: memory.slug,
    })
  }

  for (const photo of extras) {
    const prev = bySrc.get(photo.src)
    bySrc.set(photo.src, {
      src: photo.src,
      title: photo.title || prev?.title || photo.src,
      date: photo.date || prev?.date,
      slug: photo.slug || prev?.slug,
    })
  }

  return [...bySrc.values()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

export const photos: Photo[] = buildPhotos()

export function photosForSlug(slug: string): Photo[] {
  const bySrc = new Map<string, Photo>()
  for (const photo of photos) {
    if (photo.slug === slug) bySrc.set(photo.src, photo)
  }
  return [...bySrc.values()]
}

export function getExtras(): Photo[] {
  return extras
}
