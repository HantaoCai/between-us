import type { Memory } from './memories'
import type { Photo } from './photos'
import { cloudProxyBaseUrl, cloudProxyToken, isCloudProxyConfigured } from './proxyConfig'

export type SiteConfig = {
  togetherSince: string
  togetherLabel: string
}

export type MemoryInput = Omit<Memory, 'slug'> & { slug?: string }

type EditBackend = 'local' | 'cloud' | 'none'

let backendCache: EditBackend | null = null

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(data.error || `请求失败 ${res.status}`)
  }
  return data
}

function cloudHeaders(json = true): HeadersInit {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  const token = cloudProxyToken()
  if (token) headers['X-Between-Us-Token'] = token
  return headers
}

function cloudUrl(path: string): string {
  return `${cloudProxyBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
}

/** 探测编辑后端：本机 Vite 优先，否则 Cloudflare Worker + R2 */
export async function resolveEditBackend(force = false): Promise<EditBackend> {
  if (!force && backendCache) return backendCache

  try {
    const data = await requestJson<{ enabled?: boolean }>('/__edit/status')
    if (data.enabled) {
      backendCache = 'local'
      return 'local'
    }
  } catch {
    /* try cloud */
  }

  if (isCloudProxyConfigured()) {
    try {
      const data = await requestJson<{ enabled?: boolean; media?: boolean }>(
        cloudUrl('/edit/status'),
      )
      if (data.enabled || data.media) {
        backendCache = 'cloud'
        return 'cloud'
      }
    } catch {
      /* none */
    }
  }

  backendCache = 'none'
  return 'none'
}

export async function fetchEditStatus(): Promise<boolean> {
  const backend = await resolveEditBackend(true)
  return backend === 'local' || backend === 'cloud'
}

export async function saveMemory(slug: string, memory: MemoryInput) {
  const backend = await resolveEditBackend()
  if (backend !== 'local') {
    throw new Error('回忆编辑仅支持本地 npm run dev')
  }
  return requestJson<{ ok: true; slug: string }>(
    `/__edit/memory/${encodeURIComponent(slug)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memory),
    },
  )
}

export async function createMemory(memory: MemoryInput) {
  const backend = await resolveEditBackend()
  if (backend !== 'local') {
    throw new Error('回忆编辑仅支持本地 npm run dev')
  }
  return requestJson<{ ok: true; slug: string }>('/__edit/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(memory),
  })
}

export async function deleteMemory(slug: string) {
  const backend = await resolveEditBackend()
  if (backend !== 'local') {
    throw new Error('回忆编辑仅支持本地 npm run dev')
  }
  return requestJson<{ ok: true; slug: string }>(
    `/__edit/memory/${encodeURIComponent(slug)}`,
    { method: 'DELETE' },
  )
}

export async function savePhotos(photos: Photo[]) {
  const backend = await resolveEditBackend()
  if (backend !== 'local') {
    throw new Error('拾光清单写入仅支持本地 npm run dev（墙面钉照片可用线上）')
  }
  return requestJson<{ ok: true }>('/__edit/photos', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(photos),
  })
}

export async function saveSite(site: SiteConfig) {
  const backend = await resolveEditBackend()
  if (backend !== 'local') {
    throw new Error('站点配置仅支持本地 npm run dev')
  }
  return requestJson<{ ok: true; site: SiteConfig }>('/__edit/site', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(site),
  })
}

export async function fetchNotes(): Promise<unknown[]> {
  const backend = await resolveEditBackend()
  if (backend === 'local') {
    return requestJson<unknown[]>('/__edit/notes')
  }
  if (backend === 'cloud') {
    const data = await requestJson<{
      ok?: boolean
      notes?: unknown[] | null
      missing?: boolean
    }>(cloudUrl('/edit/notes'))
    if (data.missing || data.notes == null) {
      // R2 尚无墙数据：让页面继续用打包进站的 notes，首次保存再写入
      throw new Error('cloud-notes-missing')
    }
    if (!Array.isArray(data.notes)) {
      throw new Error('云端 notes 格式错误')
    }
    return data.notes
  }
  throw new Error('无编辑后端')
}

export async function saveNotes(notes: unknown) {
  const backend = await resolveEditBackend()
  if (backend === 'local') {
    return requestJson<{ ok: true }>('/__edit/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notes),
    })
  }
  if (backend === 'cloud') {
    return requestJson<{ ok: true }>(cloudUrl('/edit/notes'), {
      method: 'PUT',
      headers: cloudHeaders(true),
      body: JSON.stringify(notes),
    })
  }
  throw new Error('无编辑后端')
}

/** 手机上传前压到最长边 1600，减小流量与 R2 体积 */
async function maybeCompressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.size < 400_000) return file

  try {
    const bitmap = await createImageBitmap(file)
    const maxEdge = 1600
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    if (scale >= 0.98) {
      bitmap.close()
      return file
    }
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    )
    if (!blob) return file
    const name = file.name.replace(/\.\w+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export async function uploadPhoto(file: File) {
  const backend = await resolveEditBackend()
  const form = new FormData()

  if (backend === 'local') {
    form.append('file', file)
    return requestJson<{ ok: true; src: string; title: string }>('/__edit/upload', {
      method: 'POST',
      body: form,
    })
  }

  if (backend === 'cloud') {
    const compressed = await maybeCompressImage(file)
    form.append('file', compressed)
    return requestJson<{ ok: true; src: string; title: string }>(
      cloudUrl('/edit/upload'),
      {
        method: 'POST',
        headers: cloudHeaders(false),
        body: form,
      },
    )
  }

  throw new Error('无编辑后端')
}

export async function deletePhoto(src: string) {
  const backend = await resolveEditBackend()
  if (backend === 'local') {
    return requestJson<{ ok: true; src: string }>('/__edit/photo', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ src }),
    })
  }
  if (backend === 'cloud') {
    return requestJson<{ ok: true; src: string }>(cloudUrl('/edit/photo'), {
      method: 'DELETE',
      headers: cloudHeaders(true),
      body: JSON.stringify({ src }),
    })
  }
  throw new Error('无编辑后端')
}
