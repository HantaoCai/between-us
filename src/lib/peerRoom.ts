import { Peer, type DataConnection } from 'peerjs'
import { isValidRoomCode, normalizeRoomCode, randomRoomCode, ROOM_PREFIX } from './guessGame'
import { PEER_OPTIONS } from './peerConfig'
import { peerLog } from './peerLog'

export type RoomHandlers = {
  onData: (data: unknown) => void
  onOpen?: () => void
  /** 页面回到前台，或信令重连成功。连接还在时用来补发当前牌局 */
  onWake?: () => void
  /** 数据通道暂时断开，页面还在就会继续等 */
  onDisconnect?: () => void
  /** 自己的 Peer 被销毁，房间号暂时失效 */
  onPeerLost?: () => void
  /** 放弃重连后的最终断开 */
  onClose?: () => void
  onError?: (message: string) => void
}

export type RoomSession = {
  code: string
  peer: Peer
  conn: DataConnection | null
  isHost: boolean
  send: (data: unknown) => void
  /** 连接就绪后连发几次，避免对方还没挂上监听漏掉第一包 */
  sendReliable: (data: unknown, times?: number) => void
  destroy: () => void
}

const KEEP_MS = 4000
const BROKER_RETRY_MS = 4000
const JOIN_BACKOFF_MS = 5000
const RECONNECT_ERRORS = new Set([
  'network',
  'disconnected',
  'server-error',
  'socket-error',
  'socket-closed',
])

type WirePing = { type: '__ping' } | { type: '__pong' }

function isWirePing(raw: unknown): raw is WirePing {
  return (
    !!raw &&
    typeof raw === 'object' &&
    'type' in raw &&
    ((raw as WirePing).type === '__ping' || (raw as WirePing).type === '__pong')
  )
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function errType(err: unknown) {
  if (err && typeof err === 'object' && 'type' in err) {
    return String((err as { type?: string }).type ?? '')
  }
  return ''
}

function makePeer(id?: string) {
  return id ? new Peer(id, PEER_OPTIONS) : new Peer(PEER_OPTIONS)
}

function waitOpen(peer: Peer, ms = 15000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      peerLog('信令超时', { id: peer.id || '(pending)', ms })
      reject(new Error('连信令超时，请重试'))
    }, ms)
    const finish = (fn: () => void) => {
      window.clearTimeout(timer)
      fn()
    }
    peer.on('open', (id) => {
      peerLog('信令已开', id)
      finish(() => resolve())
    })
    peer.on('error', (err) => {
      peerLog('信令错误', err)
      finish(() => reject(err))
    })
  })
}

function isPeerIdBusy(err: unknown) {
  const type = errType(err)
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return (
    type === 'unavailable-id' ||
    /unavailable-id|is taken|already in use/i.test(msg)
  )
}

/** 手机息屏几分钟后，和信令服务器的连接会先断。不断开房间号，自己重连上去。 */
function watchPeer(peer: Peer, alive: () => boolean, onWake: () => void) {
  const kick = () => {
    if (!alive() || peer.destroyed || !peer.disconnected) return
    peerLog('信令重连', peer.id)
    try {
      peer.reconnect()
    } catch (err) {
      peerLog('信令重连失败', err)
    }
  }

  const wake = () => {
    if (!alive() || peer.destroyed) return
    kick()
    onWake()
  }

  peer.on('disconnected', () => {
    if (!alive()) return
    peerLog('信令断开', peer.id)
    kick()
  })
  peer.on('error', (err) => {
    if (!alive() || peer.destroyed) return
    const type = errType(err)
    if (!type || !RECONNECT_ERRORS.has(type)) return
    peerLog('信令可恢复错误', err)
    window.setTimeout(kick, 600)
  })
  peer.on('open', () => {
    if (!alive()) return
    peerLog('信令恢复', peer.id)
    onWake()
  })

  const timer = window.setInterval(kick, BROKER_RETRY_MS)
  const onFore = () => {
    if (document.visibilityState === 'hidden') return
    peerLog('前台唤醒')
    wake()
  }
  document.addEventListener('visibilitychange', onFore)
  window.addEventListener('online', onFore)
  window.addEventListener('pageshow', onFore)

  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onFore)
    window.removeEventListener('online', onFore)
    window.removeEventListener('pageshow', onFore)
  }
}

function makeSend(getConn: () => DataConnection | null) {
  const send = (data: unknown) => {
    const conn = getConn()
    if (conn?.open) conn.send(data)
  }
  const sendReliable = (data: unknown, times = 3) => {
    send(data)
    for (let i = 1; i < times; i++) {
      window.setTimeout(() => send(data), 250 * i)
    }
  }
  return { send, sendReliable }
}

function startKeepalive(getConn: () => DataConnection | null, alive: () => boolean) {
  const id = window.setInterval(() => {
    if (!alive()) return
    const conn = getConn()
    if (conn?.open) {
      try {
        conn.send({ type: '__ping' } satisfies WirePing)
      } catch {
        /* ignore */
      }
    }
  }, KEEP_MS)
  return () => window.clearInterval(id)
}

function wireConn(
  conn: DataConnection,
  handlers: RoomHandlers,
  opts: {
    intentional: () => boolean
    onUnexpectedClose: () => void
    label: string
  },
) {
  let opened = false
  const markOpen = () => {
    if (opened) return
    opened = true
    peerLog('数据通道已开', opts.label)
    handlers.onOpen?.()
  }

  conn.on('data', (raw) => {
    if (isWirePing(raw)) {
      if (raw.type === '__ping' && conn.open) {
        try {
          conn.send({ type: '__pong' } satisfies WirePing)
        } catch {
          /* ignore */
        }
      }
      return
    }
    handlers.onData(raw)
  })
  conn.on('open', markOpen)
  conn.on('close', () => {
    peerLog('数据通道关闭', opts.label)
    if (opts.intentional()) return
    opts.onUnexpectedClose()
  })
  conn.on('error', (err) => {
    peerLog('数据通道错误', err)
    if (opts.intentional()) return
    handlers.onError?.('连接出错')
  })

  if (conn.open) markOpen()
}

export async function createPeerRoom(
  handlers: RoomHandlers,
  options?: { code?: string },
): Promise<RoomSession> {
  const code =
    options?.code && isValidRoomCode(normalizeRoomCode(options.code))
      ? normalizeRoomCode(options.code)
      : randomRoomCode()

  peerLog('开房开始', code)
  let lastErr: unknown
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) {
      peerLog('开房重试', { code, attempt })
      await sleep(400 * attempt)
    }
    const peer = makePeer(`${ROOM_PREFIX}${code}`)
    try {
      await waitOpen(peer)
      peerLog('开房成功', { code, attempt })
      return bindHostSession(peer, code, handlers)
    } catch (err) {
      try {
        peer.destroy()
      } catch {
        /* ignore */
      }
      lastErr = err
      if (!isPeerIdBusy(err) && attempt >= 3) break
    }
  }
  peerLog('开房失败', lastErr)
  throw lastErr instanceof Error ? lastErr : new Error('开房失败，请重试')
}

/**
 * 同一房间号共用一个链接：先到的人开房，后到的人加入。
 * 占线时先短探「是否真有房主」，没有则继续抢；避免刷新后变成双方都是加入方。
 */
export async function claimOrJoinPeerRoom(
  codeRaw: string,
  handlers: RoomHandlers,
  options?: { joinTimeoutMs?: number },
): Promise<RoomSession> {
  const code = normalizeRoomCode(codeRaw)
  if (!isValidRoomCode(code)) {
    throw new Error('房间号是 6 位数字')
  }

  peerLog('共享进房', code)
  const joinTimeout = options?.joinTimeoutMs ?? 8000

  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await sleep(350 * attempt)

    const peer = makePeer(`${ROOM_PREFIX}${code}`)
    try {
      await waitOpen(peer)
      peerLog('抢到房主', { code, attempt })
      return bindHostSession(peer, code, handlers)
    } catch (err) {
      try {
        peer.destroy()
      } catch {
        /* ignore */
      }
      if (!isPeerIdBusy(err)) {
        peerLog('共享进房失败', err)
        throw err instanceof Error ? err : new Error('进房失败')
      }
      peerLog('房号占线', { code, attempt })
    }

    // 占线：可能是真房主，也可能是刚销毁还没释放。短超时试加入。
    try {
      const session = await joinPeerRoom(code, handlers, {
        timeoutMs: attempt < 3 ? 3500 : joinTimeout,
      })
      peerLog('改为加入方', { code, attempt })
      return session
    } catch (joinErr) {
      peerLog('加入探测失败，继续抢房', joinErr)
    }
  }

  peerLog('共享进房兜底加入', code)
  return joinPeerRoom(code, handlers, { timeoutMs: joinTimeout })
}

function bindHostSession(
  peer: Peer,
  code: string,
  handlers: RoomHandlers,
): RoomSession {
  let conn: DataConnection | null = null
  let intentional = false
  let stopKeep: (() => void) | null = null
  const { send, sendReliable } = makeSend(() => conn)
  const stopWatch = watchPeer(
    peer,
    () => !intentional,
    () => {
      if (intentional) return
      handlers.onWake?.()
    },
  )

  peer.on('close', () => {
    peerLog('房主 Peer 关闭', code)
    if (intentional) return
    if (handlers.onPeerLost) handlers.onPeerLost()
    else handlers.onClose?.()
  })

  const session: RoomSession = {
    code,
    peer,
    conn: null,
    isHost: true,
    send,
    sendReliable,
    destroy() {
      peerLog('销毁房主会话', code)
      intentional = true
      stopWatch()
      stopKeep?.()
      stopKeep = null
      try {
        conn?.close()
      } catch {
        /* ignore */
      }
      peer.destroy()
    },
  }

  peer.on('connection', (incoming) => {
    if (intentional) {
      incoming.close()
      return
    }
    peerLog('对方连入', incoming.peer)
    const prev = conn
    stopKeep?.()
    conn = incoming
    session.conn = incoming
    stopKeep = startKeepalive(
      () => conn,
      () => !intentional,
    )
    wireConn(incoming, handlers, {
      intentional: () => intentional,
      label: `host<-${incoming.peer}`,
      onUnexpectedClose: () => {
        if (conn !== incoming) return
        peerLog('对方断开，等待重连', code)
        handlers.onDisconnect?.()
      },
    })
    // 新通道就绪后再关旧的，减少重连抖动
    if (prev && prev !== incoming) {
      const closeOld = () => {
        try {
          prev.close()
        } catch {
          /* ignore */
        }
      }
      if (incoming.open) closeOld()
      else incoming.once('open', closeOld)
    }
  })

  return session
}

export async function joinPeerRoom(
  codeRaw: string,
  handlers: RoomHandlers,
  options?: { timeoutMs?: number },
): Promise<RoomSession> {
  const code = normalizeRoomCode(codeRaw)
  if (!isValidRoomCode(code)) {
    throw new Error('房间号是 6 位数字')
  }
  const timeoutMs = options?.timeoutMs ?? 15000
  const hostId = `${ROOM_PREFIX}${code}`

  peerLog('加入开始', { code, timeoutMs })
  const peer = makePeer(
    `${ROOM_PREFIX}${randomRoomCode()}-joiner-${Date.now().toString(36)}`,
  )
  await waitOpen(peer)

  let conn: DataConnection | null = null
  let intentional = false
  let established = false
  let retry = 0
  let retryTimer = 0
  let failTimer = 0
  let pending: DataConnection | null = null
  let stopWatch = () => {}
  const { send, sendReliable } = makeSend(() => conn)
  const life = { stopKeep: null as (() => void) | null }

  const session: RoomSession = {
    code,
    peer,
    conn: null,
    isHost: false,
    send,
    sendReliable,
    destroy() {
      peerLog('销毁加入会话', code)
      intentional = true
      if (retryTimer) window.clearTimeout(retryTimer)
      if (failTimer) window.clearTimeout(failTimer)
      stopWatch()
      life.stopKeep?.()
      life.stopKeep = null
      try {
        pending?.close()
      } catch {
        /* ignore */
      }
      try {
        conn?.close()
      } catch {
        /* ignore */
      }
      peer.destroy()
    },
  }

  peer.on('close', () => {
    peerLog('加入方 Peer 关闭', code)
    if (intentional || !established) return
    if (handlers.onPeerLost) handlers.onPeerLost()
    else handlers.onClose?.()
  })

  function attach(next: DataConnection) {
    life.stopKeep?.()
    conn = next
    session.conn = next
    life.stopKeep = startKeepalive(
      () => conn,
      () => !intentional,
    )
    wireConn(next, handlers, {
      intentional: () => intentional,
      label: `joiner->${hostId}`,
      onUnexpectedClose: () => {
        if (intentional || !established) return
        peerLog('与房主断开，准备重连', code)
        handlers.onDisconnect?.()
        scheduleReconnect()
      },
    })
  }

  function scheduleReconnect(delay?: number) {
    if (intentional || !established || conn?.open) return
    if (retryTimer) window.clearTimeout(retryTimer)
    const wait = delay ?? Math.min(JOIN_BACKOFF_MS, 700 * Math.max(1, retry))
    retry += 1
    peerLog('计划重连', { code, retry, wait })
    retryTimer = window.setTimeout(() => {
      if (intentional || conn?.open) return
      if (peer.destroyed) {
        if (handlers.onPeerLost) handlers.onPeerLost()
        else handlers.onClose?.()
        return
      }
      if (!peer.open) {
        if (peer.disconnected) {
          try {
            peer.reconnect()
          } catch {
            /* ignore */
          }
        }
        scheduleReconnect(1200)
        return
      }
      try {
        if (pending) {
          try {
            pending.close()
          } catch {
            /* ignore */
          }
          pending = null
        }
        if (failTimer) window.clearTimeout(failTimer)
        peerLog('发起重连', hostId)
        const next = peer.connect(hostId, { reliable: true })
        pending = next
        failTimer = window.setTimeout(() => {
          if (pending !== next) return
          peerLog('重连超时', hostId)
          try {
            next.close()
          } catch {
            /* ignore */
          }
          pending = null
          scheduleReconnect()
        }, 8000)
        next.on('open', () => {
          if (intentional || pending !== next) return
          window.clearTimeout(failTimer)
          pending = null
          retry = 0
          peerLog('重连成功', hostId)
          attach(next)
        })
        next.on('error', (err) => {
          if (pending !== next) return
          peerLog('重连错误', err)
          window.clearTimeout(failTimer)
          pending = null
          scheduleReconnect()
        })
      } catch (err) {
        peerLog('重连异常', err)
        scheduleReconnect()
      }
    }, wait)
  }

  const first = peer.connect(hostId, { reliable: true })
  attach(first)

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        peerLog('加入超时', { code, timeoutMs })
        reject(new Error('连不上，确认对方已进房'))
      }, timeoutMs)
      const ok = () => {
        window.clearTimeout(timer)
        resolve()
      }
      first.on('open', ok)
      first.on('error', (err) => {
        window.clearTimeout(timer)
        peerLog('首次连接错误', err)
        reject(err)
      })
      if (first.open) ok()
    })
  } catch (err) {
    intentional = true
    life.stopKeep?.()
    life.stopKeep = null
    peer.destroy()
    throw err
  }

  established = true
  peerLog('加入成功', code)
  stopWatch = watchPeer(peer, () => !intentional, () => {
    if (!intentional && !conn?.open) scheduleReconnect(200)
    handlers.onWake?.()
  })
  return session
}
