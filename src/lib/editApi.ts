import type { Memory } from './memories'
import type { Photo } from './photos'
import { compressImage } from './compressImage'

export type SiteConfig = {
  togetherSince: string
  togetherLabel: string
}

export type MemoryInput = Omit<Memory, 'slug'> & { slug?: string }

export type EditStatus = {
  enabled: boolean
  mode: 'local' | 'remote'
  needsPassword: boolean
}

const REMOTE_BASE = (import.meta.env.VITE_EDIT_API as string | undefined)?.replace(/\/$/, '') || ''
const PASSWORD_KEY = 'between-us-edit-password'

let editPassword = ''

export function isRemoteEditApi(): boolean {
  return Boolean(REMOTE_BASE)
}

export function getEditPassword(): string {
  return editPassword
}

export function loadStoredEditPassword(): string {
  try {
    editPassword = sessionStorage.getItem(PASSWORD_KEY) || ''
  } catch {
    editPassword = ''
  }
  return editPassword
}

export function setEditPassword(password: string) {
  editPassword = password
  try {
    if (password) sessionStorage.setItem(PASSWORD_KEY, password)
    else sessionStorage.removeItem(PASSWORD_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

function editUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  if (REMOTE_BASE) return `${REMOTE_BASE}${clean}`
  return `/__edit${clean}`
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (editPassword) {
    headers.set('X-Edit-Password', editPassword)
  }
  const res = await fetch(url, { ...init, headers })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(data.error || `请求失败 ${res.status}`)
  }
  return data
}

export async function fetchEditStatus(): Promise<EditStatus> {
  try {
    const data = await request<{
      enabled?: boolean
      mode?: string
      needsPassword?: boolean
    }>(editUrl('/status'))
    const mode = data.mode === 'remote' || REMOTE_BASE ? 'remote' : 'local'
    return {
      enabled: Boolean(data.enabled),
      mode,
      needsPassword: mode === 'remote' ? data.needsPassword !== false : false,
    }
  } catch {
    if (REMOTE_BASE) {
      return { enabled: false, mode: 'remote', needsPassword: true }
    }
    return { enabled: false, mode: 'local', needsPassword: false }
  }
}

export async function verifyEditPassword(password: string): Promise<boolean> {
  const prev = editPassword
  setEditPassword(password)
  try {
    await request<{ ok: true }>(editUrl('/auth'), { method: 'POST' })
    return true
  } catch {
    setEditPassword(prev)
    return false
  }
}

export async function saveMemory(slug: string, memory: MemoryInput) {
  return request<{ ok: true; slug: string }>(editUrl(`/memory/${encodeURIComponent(slug)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(memory),
  })
}

export async function createMemory(memory: MemoryInput) {
  return request<{ ok: true; slug: string }>(editUrl('/memory'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(memory),
  })
}

export async function deleteMemory(slug: string) {
  return request<{ ok: true; slug: string }>(editUrl(`/memory/${encodeURIComponent(slug)}`), {
    method: 'DELETE',
  })
}

export async function savePhotos(photos: Photo[]) {
  return request<{ ok: true }>(editUrl('/photos'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(photos),
  })
}

export async function saveSite(site: SiteConfig) {
  return request<{ ok: true; site: SiteConfig }>(editUrl('/site'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(site),
  })
}

export async function fetchNotes() {
  return request<unknown[]>(editUrl('/notes'))
}

export async function saveNotes(notes: unknown) {
  return request<{ ok: true }>(editUrl('/notes'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(notes),
  })
}

export async function uploadPhoto(file: File) {
  const prepared = await compressImage(file)
  const form = new FormData()
  form.append('file', prepared)
  return request<{ ok: true; src: string; title: string }>(editUrl('/upload'), {
    method: 'POST',
    body: form,
  })
}

export async function deletePhoto(src: string) {
  return request<{ ok: true; src: string }>(editUrl('/photo'), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ src }),
  })
}
