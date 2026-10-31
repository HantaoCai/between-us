import type { NavigateFunction } from 'react-router-dom'
import { returnToGameHub } from './hubReturn'
import type { NoteAbout } from './notes'
import { peerLog } from './peerLog'
import type { RoomHandlers } from './peerRoom'
import {
  isPeerPlayGame,
  peerGamePath,
  savePeerRoom,
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

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

type HubMeta = {
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
}

const HUB_RECALL_KEY = 'between-us:hub-recall'

/** 回大厅 / 跟进回大厅时递增；再来一局中途发现变了就放弃 */
let hubNavEpoch = 0

export function getHubNavEpoch() {
  return hubNavEpoch
}

export function bumpHubNavEpoch() {
  hubNavEpoch += 1
  return hubNavEpoch
}

/** 回大厅的浏览器打标，进大厅后再补喊几声，拉还停在对局页的对方 */
export function markHubRecall(code: string) {
  try {
    sessionStorage.setItem(HUB_RECALL_KEY, code)
  } catch {
    /* ignore */
  }
}

export function takeHubRecall(code: string): boolean {
  try {
    const v = sessionStorage.getItem(HUB_RECALL_KEY)
    if (!v || v !== code) return false
    sessionStorage.removeItem(HUB_RECALL_KEY)
    return true
  } catch {
    return false
  }
}

function followReturn(
  opts: {
    navigate: NavigateFunction
    getMeta: () => HubMeta
    onLocalLeave?: () => void
  },
  gate: { returning: boolean },
  reason: string,
) {
  if (gate.returning) return
  const meta = opts.getMeta()
  if (!meta.code) return
  gate.returning = true
  bumpHubNavEpoch()
  peerLog('跟进：回大厅', reason)
  opts.onLocalLeave?.()
  void returnToGameHub({
    code: meta.code,
    role: meta.role,
    who: meta.who,
    navigate: opts.navigate,
  })
  window.setTimeout(() => {
    gate.returning = false
  }, 2500)
}

/**
 * 包一层 onData：对方回大厅或选了别的游戏时，本页跟着跳，不拆 Peer。
 * 「回大厅」优先于「再来一局」：看到 hub-return / 大厅 hello 就走。
 */
export function withHubNav(
  handlers: RoomHandlers,
  opts: {
    navigate: NavigateFunction
    getMeta: () => HubMeta
    /** 当前所在游戏；与 hub-pick 相同则忽略 */
    hereGame?: PeerPlayGameId
    onLocalLeave?: () => void
  },
): RoomHandlers {
  const gate = {
    returning: false,
    pickGame: null as PeerPlayGameId | null,
  }
  const boundAt = Date.now()
  return {
    ...handlers,
    onData(raw) {
      // 对方已在大厅打招呼：进桌后的残留 hello 忽略一段时间，之后一律跟回
      // （解决：一方再来一局、一方回大厅后各停一页）
      // 宽限加长：刚选完游戏时对方大厅可能还在补 hello，别立刻被拉回
      if (opts.hereGame && isHubHello(raw)) {
        if (Date.now() - boundAt >= 4000) {
          followReturn(opts, gate, 'hub-hello')
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
        followReturn(opts, gate, meta.code)
        return
      }

      if (opts.hereGame && raw.game === opts.hereGame) {
        return
      }

      if (gate.pickGame === raw.game) return
      gate.pickGame = raw.game
      gate.returning = false
      peerLog('跟进：切游戏', raw.game)
      opts.onLocalLeave?.()
      savePeerRoom({
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

/** 回大厅前通知对方一起回；与「再来一局」冲突时回大厅优先 */
export async function leaveGameToHub(options: {
  sendReliable: (data: unknown, times?: number) => void
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
  navigate: NavigateFunction
  onLocalLeave?: () => void
}) {
  const { sendReliable, code, role, who, navigate, onLocalLeave } = options
  bumpHubNavEpoch()
  if (!code) {
    onLocalLeave?.()
    navigate('/games', { replace: true })
    return
  }

  markHubRecall(code)
  const msg = { type: 'hub-return' } satisfies HubControlMsg
  peerLog('广播：回大厅', code)
  for (let i = 0; i < 8; i++) {
    sendReliable(msg, 4)
    await sleep(50)
  }
  onLocalLeave?.()
  await returnToGameHub({ code, role, who, navigate })
}
