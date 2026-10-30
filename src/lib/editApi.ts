import type { Memory } from './memories'
import type { Photo } from './photos'

export type SiteConfig = {
  togetherSince: string
  togetherLabel: string
}

export type MemoryInput = Omit<Memory, 'slug'> & { slug?: string }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(data.error || `请求失败 ${res.status}`)
  }
  return data
}

export async function fetchEditStatus(): Promise<boolean> {
  try {
    const data = await request<{ enabled: boolean }>('/__edit/status')
    return Boolean(data.enabled)
  } catch {
    return false
  }
}

export async function saveMemory(slug: string, memory: MemoryInput) {
  return request<{ ok: true; slug: string }>(`/__edit/memory/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(memory),
  })
}

export async function createMemory(memory: MemoryInput) {
  return request<{ ok: true; slug: string }>('/__edit/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(memory),
  })
}

export async function deleteMemory(slug: string) {
  return request<{ ok: true; slug: string }>(
    `/__edit/memory/${encodeURIComponent(slug)}`,
    { method: 'DELETE' },
  )
}

export async function savePhotos(photos: Photo[]) {
  return request<{ ok: true }>('/__edit/photos', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(photos),
  })
}

export async function saveSite(site: SiteConfig) {
  return request<{ ok: true; site: SiteConfig }>('/__edit/site', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(site),
  })
}

export async function saveNotes(notes: unknown) {
  return request<{ ok: true }>('/__edit/notes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(notes),
  })
}

export async function uploadPhoto(file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<{ ok: true; src: string; title: string }>('/__edit/upload', {
    method: 'POST',
    body: form,
  })
}

export async function deletePhoto(src: string) {
  return request<{ ok: true; src: string }>('/__edit/photo', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ src }),
  })
}
