import { useEffect, useRef } from 'react'
import { games } from './games'
import type { NoteAbout } from './notes'

export type PeerGameId = 'guess' | 'quiz' | 'draw' | 'poker'

export type SavedPeerRoom = {
  game: PeerGameId
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
  savedAt: number
  digits?: 4 | 5
  secret?: string
  secretLocked?: boolean
}

const KEY = 'between-us:peer-room'
const COOKIE = 'bu_peer_room'
const TTL_MS = 6 * 60 * 60 * 1000
const TTL_SEC = Math.floor(TTL_MS / 1000)

export function peerGameTitle(game: PeerGameId): string {
  return games.find((g) => g.id === game)?.title ?? game
}

export function peerGamePath(game: PeerGameId): string {
  return games.find((g) => g.id === game)?.path ?? `/games/${game}`
}

function isValidRoom(parsed: unknown): parsed is SavedPeerRoom {
  if (!parsed || typeof parsed !== 'object') return false
  const p = parsed as SavedPeerRoom
  return (
    typeof p.code === 'string' &&
    /^\d{6}$/.test(p.code) &&
    (p.role === 'host' || p.role === 'joiner') &&
    (p.game === 'guess' ||
      p.game === 'quiz' ||
      p.game === 'draw' ||
      p.game === 'poker') &&
    typeof p.savedAt === 'number'
  )
}

function writeCookie(value: string | null) {
  try {
    if (value == null) {
      document.cookie = `${COOKIE}=;path=/;max-age=0;SameSite=Lax`
      return
    }
    document.cookie = `${COOKIE}=${encodeURIComponent(value)};path=/;max-age=${TTL_SEC};SameSite=Lax`
  } catch {
    /* ignore */
  }
}

function readCookie(): string | null {
  try {
    const match = document.cookie
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE}=`))
    if (!match) return null
    return decodeURIComponent(match.slice(COOKIE.length + 1))
  } catch {
    return null
  }
}

export function savePeerRoom(
  room: Omit<SavedPeerRoom, 'savedAt'> & { savedAt?: number },
): void {
  const next: SavedPeerRoom = {
    ...room,
    savedAt: room.savedAt ?? Date.now(),
  }
  const raw = JSON.stringify(next)
  try {
    localStorage.setItem(KEY, raw)
  } catch {
    /* ignore quota / private mode */
  }
  writeCookie(raw)
}

export function readPeerRoom(): SavedPeerRoom | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    raw = null
  }
  if (!raw) raw = readCookie()
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isValidRoom(parsed)) {
      clearPeerRoom()
      return null
    }
    if (Date.now() - parsed.savedAt > TTL_MS) {
      clearPeerRoom()
      return null
    }
    // 两边对齐，避免微信只清了其中一侧
    try {
      localStorage.setItem(KEY, raw)
    } catch {
      /* ignore */
    }
    writeCookie(raw)
    return parsed
  } catch {
    return null
  }
}

export function clearPeerRoom(game?: PeerGameId): void {
  try {
    if (game) {
      const cur = readPeerRoom()
      if (cur && cur.game !== game) return
    }
    localStorage.removeItem(KEY)
    writeCookie(null)
  } catch {
    writeCookie(null)
  }
}

export function patchPeerRoom(patch: Partial<SavedPeerRoom>): void {
  const cur = readPeerRoom()
  if (!cur) return
  savePeerRoom({ ...cur, ...patch, savedAt: Date.now() })
}

/** 离开页面前再写一次，减少微信直接杀 WebView 时丢存档 */
export function useFlushPeerRoomOnLeave(
  enabled: boolean,
  build: () => Omit<SavedPeerRoom, 'savedAt'> | null,
) {
  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    if (!enabled) return
    const flush = () => {
      const room = buildRef.current()
      if (room) savePeerRoom(room)
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [enabled])
}
