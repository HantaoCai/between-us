import type { Memory } from './memories'
import type { Photo } from './photos'
import {
  cloudProxyBaseUrl,
  isCloudProxyConfigured,
  resolveEditToken,
} from './proxyConfig'

export type SiteConfig = {
  togetherSince: string
  togetherLabel: string
}

export type MemoryInput = Omit<Memory, 'slug'> & { slug?: string }

export type EditStatus = {
  available: boolean
  backend: EditBackend
  /** 云端写接口需要口令（Worker 配了 PROXY_TOKEN） */
  authRequired: boolean
}

type EditBackend = 'local' | 'cloud' | 'none'

let backendCache: EditBackend | null = null
let authRequiredCache = false

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(data.error || `请求失败 ${res.status}`)
  }
  return data
}

function cloudHeaders(json = true, tokenOverride?: string): HeadersInit {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  const token = (tokenOverride ?? resolveEditToken()).trim()
  if (token) headers['X-Between-Us-Token'] = token
  return headers
}

function cloudUrl(path: string): string {
  return `${cloudProxyBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
}

/** 探测编辑后端：本机 Vite 优先，否则 Cloudflare Worker + R2 */
export async function resolveEditBackend(force = false): Promise<EditBackend> {
  const status = await fetchEditStatus(force)
  return status.backend
}

export async function fetchEditStatus(force = false): Promise<EditStatus> {
  if (!force && backendCache) {
    return {
      available: backendCache === 'local' || backendCache === 'cloud',
      backend: backendCache,
      authRequired: backendCache === 'cloud' && authRequiredCache,
    }
  }

  try {
    const data = await requestJson<{ enabled?: boolean }>('/__edit/status')
    if (data.enabled) {
      backendCache = 'local'
      authRequiredCache = false
      return { available: true, backend: 'local', authRequired: false }
    }
  } catch {
    /* try cloud */
  }

  if (isCloudProxyConfigured()) {
    try {
      const data = await requestJson<{
        enabled?: boolean
        media?: boolean
        authRequired?: boolean
      }>(cloudUrl('/edit/status'))
      if (data.enabled || data.media) {
        backendCache = 'cloud'
        authRequiredCache = Boolean(data.authRequired)
        return {
          available: true,
          backend: 'cloud',
          authRequired: authRequiredCache,
        }
      }
    } catch {
      /* none */
    }
  }

  backendCache = 'none'
  authRequiredCache = false
  return { available: false, backend: 'none', authRequired: false }
}

/** 校验编辑口令；无 PROXY_TOKEN 时服务端放行 */
export async function verifyEditAuth(token: string) {
  const status = await fetchEditStatus()
  if (status.backend === 'local') return
  if (status.backend !== 'cloud') {
    throw new Error('无编辑后端')
  }
  const trimmed = token.trim()
  if (status.authRequired && !trimmed) {
    throw new Error('请输入口令')
  }
  const res = await fetch(cloudUrl('/edit/auth'), {
    method: 'POST',
    headers: cloudHeaders(true, trimmed),
    body: '{}',
  })
  // 旧 Worker 还没有 /edit/auth：有口令要求时先写入会话，真正写入时再校验
  if (res.status === 404) {
    if (status.authRequired && !trimmed) {
      throw new Error('请输入口令')
    }
    return
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    throw new Error(data.error || `请求失败 ${res.status}`)
  }
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

const WALL_THUMB_MAX = 360

type ResizeResult = { file: File; scaled: boolean }

/** 用 canvas 缩到最长边 maxEdge，输出 jpeg */
async function resizeImageJpeg(
  file: Blob,
  maxEdge: number,
  quality: number,
  fileName: string,
): Promise<ResizeResult | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return null
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (!blob) return null
    return {
      file: new File([blob], fileName, { type: 'image/jpeg' }),
      scaled: scale < 0.98,
    }
  } catch {
    return null
  }
}

/** 手机上传前压到最长边 1600，减小流量与 R2 体积 */
async function maybeCompressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.size < 400_000) return file

  const name = file.name.replace(/\.\w+$/, '') + '.jpg'
  const resized = await resizeImageJpeg(file, 1600, 0.85, name)
  if (!resized || !resized.scaled) return file
  return resized.file
}

/** 墙上缩略图：最长边 360，跟本地 sips -Z 360 对齐 */
async function makeWallThumb(file: Blob, baseName: string): Promise<File | null> {
  const safe = baseName.replace(/\.\w+$/, '') || 'photo'
  const resized = await resizeImageJpeg(file, WALL_THUMB_MAX, 0.82, `${safe}.jpg`)
  return resized?.file ?? null
}

function mediaPhotoKeyFromSrc(src: string): string | null {
  try {
    if (!src.includes('/media/')) return null
    const path = src.split('/media/')[1] || ''
    const key = decodeURIComponent(path.split('?')[0]).replace(/^\/+/, '')
    if (!key.startsWith('photos/') || key.startsWith('photos/thumbs/')) return null
    if (key.includes('..') || key.split('/').length !== 2) return null
    return key
  } catch {
    return null
  }
}

/** 云端钉图后补传 thumbs（失败不影响主流程；旧图靠 Worker 回退原图） */
async function uploadCloudWallThumb(src: string, source: Blob) {
  const key = mediaPhotoKeyFromSrc(src)
  if (!key) return
  const name = key.slice('photos/'.length)
  const thumb = await makeWallThumb(source, name)
  if (!thumb) return

  const form = new FormData()
  form.append('file', thumb, name)
  form.append('key', `photos/thumbs/${name}`)
  await requestJson<{ ok: true }>(cloudUrl('/edit/object'), {
    method: 'POST',
    headers: cloudHeaders(false),
    body: form,
  })
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
    const result = await requestJson<{ ok: true; src: string; title: string }>(
      cloudUrl('/edit/upload'),
      {
        method: 'POST',
        headers: cloudHeaders(false),
        body: form,
      },
    )
    try {
      await uploadCloudWallThumb(result.src, compressed)
    } catch {
      /* 墙面会回退原图；下次再钉仍会补 thumb */
    }
    return result
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
