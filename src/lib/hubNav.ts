import type { NavigateFunction } from 'react-router-dom'
import { decideGamePageHubPick } from './hubRoom'
import { returnToGameHub } from './hubReturn'
import type { NoteAbout } from './notes'
import { peerLog } from './peerLog'
import type { RoomHandlers } from './peerRoom'
import { reportRoomProgress } from './peerRoom'
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
  | {
      type: 'hub-pick'
      game: PeerPlayGameId
      pickId?: number
      /** 房主大厅主动点选：对方即使 parked 也跟进 */
      pull?: boolean
    }

/** 房主每次选游戏递增，便于同游戏 re-pick 与洪水去重 */
let hubPickSeq = 0

export function nextHubPickId(): number {
  hubPickSeq += 1
  return hubPickSeq
}

export function makeHubPick(
  game: PeerPlayGameId,
  opts?: { pull?: boolean },
): Extract<HubControlMsg, { type: 'hub-pick' }> {
  return {
    type: 'hub-pick',
    game,
    pickId: nextHubPickId(),
    ...(opts?.pull ? { pull: true } : {}),
  }
}

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
  const pick = makeHubPick(opts.hereGame)
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
    /** 当前所在游戏；同游戏 hub-pick 走 onSameGameRepick 重同步 */
    hereGame?: PeerPlayGameId
    onLocalLeave?: () => void
    /** 房主用来在对方后进大厅时补发 hub-pick */
    sendReliable?: (data: unknown, times?: number) => void
    /** 对方独自回大厅时回调（可选，用于提示） */
    onPeerHubReturn?: () => void
    /**
     * 已在目标游戏页又收到 hub-pick：不要 silent return。
     * 房主多次切回同一游戏时，用来重绑/要盘/补发牌。
     */
    onSameGameRepick?: (game: PeerPlayGameId) => void
  },
): RoomHandlers {
  const gate = {
    returning: false,
    pickGame: null as PeerPlayGameId | null,
    lastPickAt: 0,
    lastPeerHereAt: 0,
    lastSameRepickAt: 0,
    lastAppliedPickId: 0,
    navTimer: 0,
    navTarget: null as PeerPlayGameId | null,
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
      // 大厅 hub-hello：告知「我还在对局」（不回 hub-hello，避免与大厅互相拉扯）
      // 房主再视情况补 hub-pick；对方若已 parked 会自己点继续
      if (opts.hereGame && isHubHello(raw)) {
        const meta = opts.getMeta()
        if (opts.sendReliable && meta.who) {
          const now = Date.now()
          if (now - gate.lastPeerHereAt > 800) {
            gate.lastPeerHereAt = now
            opts.sendReliable(
              { type: 'hub-peer-here', who: meta.who, game: opts.hereGame },
              2,
            )
          }
        }
        if (meta.role === 'host') {
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

      const pickId =
        typeof raw.pickId === 'number' && Number.isFinite(raw.pickId)
          ? raw.pickId
          : 0
      const decision = decideGamePageHubPick({
        hereGame: opts.hereGame,
        pickGame: raw.game,
        pickId,
        lastAppliedPickId: gate.lastAppliedPickId,
        lastSameRepickAt: gate.lastSameRepickAt,
        now: Date.now(),
      })
      if (decision === 'ignore') return
      if (pickId > 0) gate.lastAppliedPickId = pickId

      if (decision === 'repick') {
        // 取消尚未执行的换游戏导航，避免「先收到别的再收到本游戏」把人带走
        if (gate.navTimer) {
          window.clearTimeout(gate.navTimer)
          gate.navTimer = 0
          gate.navTarget = null
        }
        gate.lastSameRepickAt = Date.now()
        gate.returning = false
        gate.peerAtHub = false
        peerLog('同游戏 re-pick', raw.game)
        opts.onSameGameRepick?.(raw.game)
        return
      }

      // 连切时合并导航：只跟安静窗口内最后一次，避免 poker→guess→draw 连环挂载
      gate.navTarget = raw.game
      gate.returning = false
      gate.peerAtHub = false
      if (gate.navTimer) window.clearTimeout(gate.navTimer)
      gate.navTimer = window.setTimeout(() => {
        gate.navTimer = 0
        const target = gate.navTarget
        gate.navTarget = null
        if (!target) return
        if (opts.hereGame && target === opts.hereGame) {
          peerLog('同游戏 re-pick（合并后）', target)
          opts.onSameGameRepick?.(target)
          return
        }
        if (pickId <= 0 && gate.pickGame === target) return
        gate.pickGame = target
        peerLog('跟进：切游戏', target)
        opts.onLocalLeave?.()
        savePlayPeerRoom({
          game: target,
          code: meta.code,
          role: meta.role,
          who: meta.who,
        })
        opts.navigate(`${peerGamePath(target)}?resume=1`)
        window.setTimeout(() => {
          if (gate.pickGame === target) gate.pickGame = null
        }, 2500)
      }, 120)
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
  // 也不清中继 activeGame：对方可能还在对局；新 hub-pick 会覆盖
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

/** 进某游戏时同步中继房间进度（24h 内同号可见） */
export function publishRoomGame(
  sendReliable: (data: unknown, times?: number) => void,
  game: PeerPlayGameId | 'hub',
) {
  reportRoomProgress(sendReliable, game)
}
