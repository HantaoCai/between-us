import { useEffect, useRef, type MutableRefObject } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { withHubNav } from './hubNav'
import { otherAbout, type NoteAbout } from './notes'
import type { RoomHandlers, RoomSession } from './peerRoom'
import type { PeerPlayGameId } from './peerRoomSave'

/** 对局页换绑 withHubNav 时需要的房间发送能力 */
export type GameSessionRoom = {
  code: string
  sendReliable: (data: unknown, times?: number) => void
}

export type GameSessionMeta = {
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
}

/**
 * 包一层 hub 导航：替换各页重复的 navHandlers。
 * onLocalLeave 通常只清 sessionRef，勿置 leavingHubRef。
 */
export function wrapGameHandlers(
  inner: RoomHandlers,
  opts: {
    hereGame: PeerPlayGameId
    navigate: NavigateFunction
    room: GameSessionRoom
    getMeta: () => GameSessionMeta
    onLocalLeave?: () => void
    onPeerHubReturn?: () => void
  },
): RoomHandlers {
  return withHubNav(inner, {
    navigate: opts.navigate,
    sendReliable: (data, times) => opts.room.sendReliable(data, times),
    hereGame: opts.hereGame,
    getMeta: () => {
      const meta = opts.getMeta()
      return {
        code: meta.code || opts.room.code,
        role: meta.role,
        who: meta.who,
      }
    },
    onLocalLeave: opts.onLocalLeave,
    onPeerHubReturn: opts.onPeerHubReturn,
  })
}

/** 收到对局 hello 后对齐 peerWho / 加入方身份 */
export function applyPeerHelloIdentity(opts: {
  peerWho: NoteAbout
  isHost: boolean
  whoRef: MutableRefObject<NoteAbout>
  setWho: (who: NoteAbout) => void
  setPeerWho: (who: NoteAbout) => void
  /** 加入方身份被纠正后补发 hello */
  sendHello?: (who: NoteAbout) => void
  onAligned?: () => void
}): { correctedWho: boolean } {
  opts.setPeerWho(opts.peerWho)
  opts.onAligned?.()
  if (opts.isHost) return { correctedWho: false }
  const mine = otherAbout(opts.peerWho)
  if (opts.whoRef.current === mine) return { correctedWho: false }
  opts.whoRef.current = mine
  opts.setWho(mine)
  opts.sendHello?.(mine)
  return { correctedWho: true }
}

/** 房主权威包序：take 拒绝旧包；adopt 强制抬水位（sync） */
export function createSeqGate(initial = 0) {
  let seq = initial
  let seen = initial
  return {
    get seq() {
      return seq
    },
    get seen() {
      return seen
    },
    next(): number {
      seq += 1
      if (seq > seen) seen = seq
      return seq
    },
    setSeq(n: number) {
      seq = n
      if (n > seen) seen = n
    },
    take(n: unknown): boolean {
      if (typeof n !== 'number' || !Number.isFinite(n)) return true
      if (n <= seen) return false
      seen = n
      return true
    },
    adopt(n: unknown) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return
      if (n > seen) seen = n
      if (n > seq) seq = n
    },
    resetSeen() {
      seen = 0
    },
    resetAll() {
      seq = 0
      seen = 0
    },
  }
}

export type SeqGate = ReturnType<typeof createSeqGate>

/**
 * 连接恢复时的同步节奏（扑克族）：
 * host → hello + 有 peer 则推权威；joiner → hello + 清 seen + need-sync
 */
export function createLinkSync(opts: {
  hello: () => void
  isHost: () => boolean
  peerKnown: () => boolean
  hostPush: () => void
  joinerPull: () => void
  getSession: () => RoomSession | null | undefined
  onClearError?: () => void
  onResetReenter?: () => void
}) {
  function onOpen() {
    opts.onClearError?.()
    opts.onResetReenter?.()
    opts.hello()
    if (opts.isHost()) {
      if (opts.peerKnown()) opts.hostPush()
      return
    }
    opts.joinerPull()
  }

  function onWake() {
    const session = opts.getSession()
    if (!session?.conn?.open) return
    opts.onClearError?.()
    opts.hello()
    if (opts.isHost()) {
      opts.hostPush()
      return
    }
    opts.joinerPull()
  }

  function onDisconnect() {
    // 旧通道晚关时新连接可能已 open，别盖成断线
    if (opts.getSession()?.conn?.open) return
    return true
  }

  return { onOpen, onWake, onDisconnect }
}

/**
 * 断线后按角色重进房。调用方提供 getCode / create / join。
 * leavingHubRef 为 true 时不再重试。
 */
export function usePeerReenter(opts: {
  maxAttempts?: number
  backoffMs?: number
  leavingHubRef: MutableRefObject<boolean>
  getCode: () => string
  isHost: () => boolean
  create: (code: string) => void | Promise<void>
  join: (code: string) => void | Promise<void>
  onRetry?: (attempt: number, max: number) => void
  onGiveUp?: () => void
}) {
  const reenterRef = useRef(0)
  const timerRef = useRef(0)
  const maxAttempts = opts.maxAttempts ?? 8
  const backoffMs = opts.backoffMs ?? 800
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current)
    },
    [],
  )

  function reset() {
    reenterRef.current = 0
    window.clearTimeout(timerRef.current)
    timerRef.current = 0
  }

  function reenter() {
    const o = optsRef.current
    const code = o.getCode()
    if (!code || o.leavingHubRef.current || timerRef.current) return
    reenterRef.current += 1
    if (reenterRef.current > maxAttempts) {
      o.onGiveUp?.()
      return
    }
    o.onRetry?.(reenterRef.current, maxAttempts)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0
      if (o.leavingHubRef.current) return
      if (o.isHost()) void o.create(code)
      else void o.join(code)
    }, backoffMs * reenterRef.current)
  }

  function isPending() {
    return timerRef.current !== 0
  }

  return { reenter, reset, reenterRef, isPending }
}
