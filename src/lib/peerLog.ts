const MAX = 120

export type PeerLogEntry = {
  t: number
  msg: string
  detail?: string
}

const ring: PeerLogEntry[] = []
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

export function peerLog(msg: string, detail?: unknown) {
  let text: string | undefined
  if (detail !== undefined) {
    if (detail instanceof Error) {
      const type =
        detail && typeof detail === 'object' && 'type' in detail
          ? String((detail as { type?: string }).type ?? '')
          : ''
      text = type ? `${type}: ${detail.message}` : detail.message
    } else if (typeof detail === 'string') {
      text = detail
    } else {
      try {
        text = JSON.stringify(detail)
      } catch {
        text = String(detail)
      }
    }
  }
  ring.push({ t: Date.now(), msg, detail: text })
  if (ring.length > MAX) ring.splice(0, ring.length - MAX)
  if (import.meta.env.DEV) {
    console.info('[peer]', msg, text ?? '')
  }
  notify()
}

export function getPeerLogs(): PeerLogEntry[] {
  return ring.slice()
}

export function formatPeerLogs(): string {
  return getPeerLogs()
    .map((e) => {
      const time = new Date(e.t).toISOString().slice(11, 23)
      return e.detail ? `${time} ${e.msg} | ${e.detail}` : `${time} ${e.msg}`
    })
    .join('\n')
}

export function clearPeerLogs() {
  ring.length = 0
  notify()
}

export function subscribePeerLogs(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

declare global {
  interface Window {
    __peerRoomLog?: () => string
  }
}

if (typeof window !== 'undefined') {
  window.__peerRoomLog = formatPeerLogs
}
