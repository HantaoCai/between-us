import type { NavigateFunction } from 'react-router-dom'
import { returnToGameHub } from './hubReturn'
import type { NoteAbout } from './notes'
import { peerLog } from './peerLog'
import type { RoomHandlers } from './peerRoom'
import {
  isPeerPlayGame,
  peerGamePath,
  readPeerRoom,
  savePlayPeerRoom,
  type PeerPlayGameId,
} from './peerRoomSave'

/** 跨页面房间导航：回大厅 / 跟进选游戏（游戏页也要认，不能只靠大厅回调） */
export type HubControlMsg =
  | { type: 'hub-return' }
  | { type: 'hub-pick'; game: PeerPlayGameId }

export function isHubControlMsg(raw: unknown): raw is HubControlMsg {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) return false
  const msg = raw as HubControlMsg
  if (msg.type === 'hub-return') return true
  if (msg.type === 'hub-pick') return isPeerPlayGame(msg.game)
  return false
}

function isHubHello(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === 'object' &&
    'type' in raw &&
    (raw as { type: string }).type === 'hub-hello'
  )
}

type HubMeta = {
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
}

/** 回大厅 / 跟进回大厅时递增；再来一局中途发现变了就放弃 */
let hubNavEpoch = 0

export function getHubNavEpoch() {
  return hubNavEpoch
}

export function bumpHubNavEpoch() {
  hubNavEpoch += 1
  return hubNavEpoch
}

/** 房主已在对局页、对方还停在大厅时，补发 hub-pick 把他拉进来 */
function reannounceHubPick(opts: {
  hereGame?: PeerPlayGameId
  sendReliable?: (data: unknown, times?: number) => void
  gate: { lastPickAt: number }
}) {
  if (!opts.hereGame || !opts.sendReliable) return
  const now = Date.now()
  if (now - opts.gate.lastPickAt < 1200) return
  opts.gate.lastPickAt = now
  const pick = { type: 'hub-pick', game: opts.hereGame } satisfies HubControlMsg
  peerLog('对局中：对方还在大厅，补发 hub-pick', opts.hereGame)
  const send = opts.sendReliable
  for (let i = 0; i < 5; i++) {
    window.setTimeout(() => send(pick, 3), 80 * i)
  }
}

/**
 * 包一层 onData：对方选了别的游戏时本页跟着跳，不拆 Peer。
 * 回大厅只自己走：不跟进 hub-return；对方已回大厅时也不再 hub-pick 拉人。
 */
export function withHubNav(
  handlers: RoomHandlers,
  opts: {
    navigate: NavigateFunction
    getMeta: () => HubMeta
    /** 当前所在游戏；与 hub-pick 相同则忽略 */
    hereGame?: PeerPlayGameId
    onLocalLeave?: () => void
    /** 房主用来在对方后进大厅时补发 hub-pick */
    sendReliable?: (data: unknown, times?: number) => void
    /** 对方独自回大厅时回调（可选，用于提示） */
    onPeerHubReturn?: () => void
  },
): RoomHandlers {
  const gate = {
    returning: false,
    pickGame: null as PeerPlayGameId | null,
    lastPickAt: 0,
    /** 对方已明确回大厅：不要再用 hub-pick 往回拽 */
    peerAtHub: false,
  }
  const pullLateJoiner = () => {
    if (gate.peerAtHub) return
    if (opts.getMeta().role !== 'host') return
    reannounceHubPick({
      hereGame: opts.hereGame,
      sendReliable: opts.sendReliable,
      gate,
    })
  }
  return {
    ...handlers,
    onOpen() {
      // 对方若已回大厅，别再 hub-pick
      pullLateJoiner()
      handlers.onOpen?.()
    },
    onWake() {
      // 唤醒不补 hub-pick：前台抖动会打断大厅重新匹配
      handlers.onWake?.()
    },
    onData(raw) {
      // 大厅 hub-hello：仅当对方还没回大厅时，房主才补 hub-pick
      if (opts.hereGame && isHubHello(raw)) {
        if (opts.getMeta().role === 'host') {
          pullLateJoiner()
        }
        return
      }

      if (!isHubControlMsg(raw)) {
        handlers.onData(raw)
        return
      }
      const meta = opts.getMeta()
      if (!meta.code) return

      if (raw.type === 'hub-return') {
        // 对方自己回大厅：留下继续玩，不强拉，也不再 hub-pick
        gate.peerAtHub = true
        peerLog('对方回大厅（不跟进）', meta.code)
        opts.onPeerHubReturn?.()
        return
      }

      if (opts.hereGame && raw.game === opts.hereGame) {
        return
      }

      if (gate.pickGame === raw.game) return
      gate.pickGame = raw.game
      gate.returning = false
      gate.peerAtHub = false
      peerLog('跟进：切游戏', raw.game)
      opts.onLocalLeave?.()
      savePlayPeerRoom({
        game: raw.game,
        code: meta.code,
        role: meta.role,
        who: meta.who,
      })
      opts.navigate(`${peerGamePath(raw.game)}?resume=1`)
      window.setTimeout(() => {
        if (gate.pickGame === raw.game) gate.pickGame = null
      }, 2500)
    },
  }
}

/** 只自己回大厅；不广播强拉。对方可留在对局，大厅显示「继续游戏」 */
export async function leaveGameToHub(options: {
  sendReliable: (data: unknown, times?: number) => void
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
  navigate: NavigateFunction
  onLocalLeave?: () => void
  fromGame?: PeerPlayGameId
}) {
  const { code, role, who, navigate, onLocalLeave, fromGame } = options
  bumpHubNavEpoch()
  if (!code) {
    onLocalLeave?.()
    navigate('/games', { replace: true })
    return
  }

  const saved = readPeerRoom()
  const parked =
    fromGame ??
    (saved && isPeerPlayGame(saved.game) ? saved.game : undefined)

  // 不发 hub-return：旧端收到仍会强拉跟进；对方留在对局即可
  peerLog('自己回大厅（不拉对方）', code)
  onLocalLeave?.()
  await returnToGameHub({
    code,
    role,
    who,
    navigate,
    parkedGame: parked ?? null,
  })
}
