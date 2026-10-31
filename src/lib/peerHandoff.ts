import { peerLog } from './peerLog'
import {
  QUIET_HANDLERS,
  type RoomHandlers,
  type RoomSession,
} from './peerRoom'

/** 大厅 ↔ 对局页 ↔ 墙 之间暂存活连接，避免同号 Peer 拆了再建 */
let parked: RoomSession | null = null

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function parkPeerSession(session: RoomSession | null | undefined) {
  if (!session) return
  try {
    session.setHandlers(QUIET_HANDLERS)
  } catch {
    /* ignore */
  }
  if (parked && parked !== session) {
    peerLog('移交：丢掉旧暂存', parked.code)
    try {
      parked.destroy()
    } catch {
      /* ignore */
    }
  }
  parked = session
  peerLog('移交：暂存连接', {
    code: session.code,
    host: session.isHost,
    open: !!session.conn?.open,
  })
}

export function peekPeerHandoff(): RoomSession | null {
  return parked
}

/**
 * 取出暂存连接。身份不符时放回，绝不销毁——避免大厅误拿对局 Peer 后拆掉。
 */
export function takePeerHandoff(
  code: string,
  expectHost: boolean,
  handlers: RoomHandlers,
): RoomSession | null {
  const session = parked
  if (!session) return null

  if (session.peer.destroyed) {
    peerLog('移交：暂存已毁', code)
    parked = null
    return null
  }
  if (session.code !== code || session.isHost !== expectHost) {
    peerLog('移交：身份不符，放回', {
      want: { code, expectHost },
      got: { code: session.code, host: session.isHost },
    })
    return null
  }

  parked = null
  session.setHandlers(handlers)
  peerLog('移交：接上连接', {
    code: session.code,
    host: session.isHost,
    open: !!session.conn?.open,
  })
  return session
}

/**
 * 尽量接回暂存 Peer。
 * StrictMode 会晚一点才 park；同房号若接不上，先释放，避免随后 create 报 ID is taken。
 */
export async function adoptParkedSession(
  code: string,
  expectHost: boolean,
  handlers: RoomHandlers,
): Promise<RoomSession | null> {
  for (let i = 0; i < 10; i++) {
    const got = takePeerHandoff(code, expectHost, handlers)
    if (got) return got

    const peek = peekPeerHandoff()
    if (peek && peek.code === code && peek.isHost === expectHost) {
      await sleep(100)
      continue
    }
    if (peek && peek.code === code) {
      peerLog('移交：同房号角色不符，释放后再占', code)
      clearPeerHandoff()
      await sleep(900)
      return null
    }
    // 等上一页把连接 park 进来
    if (i < 5) await sleep(100)
    else break
  }
  return null
}

/** 重建前：若暂存还占着同房号，先拆掉并等信令释放 */
export async function releaseParkedRoom(code: string) {
  const peek = peekPeerHandoff()
  if (!peek || peek.code !== code) return
  peerLog('移交：重建前释放同房号', code)
  clearPeerHandoff()
  await sleep(900)
}

/** @deprecated 用 adoptParkedSession */
export async function takePeerHandoffSoon(
  code: string,
  expectHost: boolean,
  handlers: RoomHandlers,
): Promise<RoomSession | null> {
  return adoptParkedSession(code, expectHost, handlers)
}

export function clearPeerHandoff() {
  if (!parked) return
  try {
    parked.destroy()
  } catch {
    /* ignore */
  }
  parked = null
}
