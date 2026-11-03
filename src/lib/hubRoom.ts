import { aboutLabel, otherAbout, type NoteAbout } from './notes'

/** 大厅入座：空房自选 / 已有一人自动对侧 / 满两人旁观 */
export type LobbySeatMode = 'pick' | 'auto-other' | 'spectate'

export type HubWireSeat = 'player' | 'spectator'

export type HubHelloMsg = {
  type: 'hub-hello'
  who: NoteAbout
  seat?: HubWireSeat
}

export type HubSeatState = {
  who: NoteAbout
  peerWho: NoteAbout | null
  isHost: boolean
  isSpectator: boolean
}

export type HubHelloResult = {
  /** 忽略此包（旁观 hello 打到对战席等） */
  ignore: boolean
  who: NoteAbout
  peerWho: NoteAbout | null
  /** 是否应回发 hello */
  replyHello: boolean
}

export type HubPickDecision =
  | { action: 'follow' }
  | { action: 'ignore'; reason: 'spectator' | 'parked' | 'entering' }

export type HubRoomView =
  | 'wait-peer'
  | 'syncing'
  | 'host-ready'
  | 'guest-ready'
  | 'spectate'
  | 'solo-ready'

export type PickGate =
  | { ok: true }
  | { ok: false; reason: string }

/** 在线人数 → 大厅入座模式 */
export function seatModeForPeers(peers: number): LobbySeatMode {
  if (peers <= 0) return 'pick'
  if (peers === 1) return 'auto-other'
  return 'spectate'
}

export function enterLabelForPeers(peers: number): string {
  if (peers <= 0) return '进入房间'
  if (peers === 1) return '加入（自动另一边）'
  return '旁观进入'
}

export function lobbyHintForMode(
  mode: LobbySeatMode,
  who: NoteAbout,
): string {
  if (mode === 'pick') {
    return `对方进房后自动是 ${aboutLabel(otherAbout(who))}。`
  }
  if (mode === 'spectate') {
    return '对战席已满，进来只能旁观。'
  }
  return '房里已有一人，进房后自动成为另一边。'
}

/**
 * 处理 hub-hello，纯函数：不碰网络。
 * 规则：房主身份为准；第二席切到对侧；旁观不占席。
 */
export function resolveHubHello(
  state: HubSeatState,
  msg: HubHelloMsg,
): HubHelloResult {
  const fromSpectator = msg.seat === 'spectator'

  if (state.isSpectator) {
    if (fromSpectator) {
      return {
        ignore: true,
        who: state.who,
        peerWho: state.peerWho,
        replyHello: false,
      }
    }
    return {
      ignore: false,
      who: state.who,
      peerWho: msg.who,
      replyHello: false,
    }
  }

  if (fromSpectator) {
    return {
      ignore: true,
      who: state.who,
      peerWho: state.peerWho,
      replyHello: state.isHost,
    }
  }

  if (state.isHost) {
    const peer = otherAbout(state.who)
    const firstSight = state.peerWho !== peer
    return {
      ignore: false,
      who: state.who,
      peerWho: peer,
      replyHello: firstSight,
    }
  }

  const hostWho = msg.who
  const mine = otherAbout(hostWho)
  return {
    ignore: false,
    who: mine,
    peerWho: hostWho,
    replyHello: true,
  }
}

/** 大厅收到 hub-pick：旁观 / 已主动回大厅 / 正在进游戏 → 忽略 */
export function decideHubPick(opts: {
  isSpectator: boolean
  entering: boolean
  parkedGame: string | null | undefined
}): HubPickDecision {
  if (opts.isSpectator) return { action: 'ignore', reason: 'spectator' }
  if (opts.entering) return { action: 'ignore', reason: 'entering' }
  if (opts.parkedGame) return { action: 'ignore', reason: 'parked' }
  return { action: 'follow' }
}

/** 房主点游戏前的门禁 */
export function canHostPickGame(opts: {
  isHost: boolean
  isSpectator: boolean
  busy: boolean
  picking: boolean
  entering: boolean
  who: NoteAbout
  peerWho: NoteAbout | null
  connOpen: boolean
  solo: boolean
  game: string
}): PickGate {
  if (opts.isSpectator) return { ok: false, reason: '旁观不能开局' }
  if (!opts.isHost) return { ok: false, reason: '等房主开始' }
  if (opts.busy) return { ok: false, reason: '还在准备房间，稍等' }
  if (opts.picking || opts.entering) {
    return { ok: false, reason: '正在进入，请稍等…' }
  }
  if (!opts.peerWho) {
    return { ok: false, reason: '等对方进房或添加机器人后再选游戏' }
  }
  if (opts.peerWho === opts.who) {
    return { ok: false, reason: '身份还没同步好，稍等再选' }
  }
  if (!opts.solo && !opts.connOpen) {
    return { ok: false, reason: '对方还没连上，稍等再选' }
  }
  if (opts.solo && opts.game !== 'gomoku') {
    return { ok: false, reason: '机器人目前只能下五子棋' }
  }
  return { ok: true }
}

/** 房间页该显示哪一类界面 */
export function hubRoomView(opts: {
  isSpectator: boolean
  isHost: boolean
  peerWho: NoteAbout | null
  solo: boolean
  reconnecting: boolean
}): HubRoomView {
  if (opts.isSpectator) return 'spectate'
  if (opts.solo && opts.peerWho) return 'solo-ready'
  if (!opts.peerWho) {
    if (opts.isHost && !opts.reconnecting) return 'wait-peer'
    return 'syncing'
  }
  return opts.isHost ? 'host-ready' : 'guest-ready'
}

export function hubRoomDetail(opts: {
  view: HubRoomView
  who: NoteAbout
  peerWho: NoteAbout | null
  solo: boolean
}): string {
  const { view, who, peerWho, solo } = opts
  if (view === 'spectate') {
    return peerWho
      ? `旁观中 · ${aboutLabel(peerWho)}在房`
      : '旁观中 · 对战席同步中…'
  }
  if (view === 'wait-peer') {
    return `你是${aboutLabel(who)} · 等对方从列表进同一间`
  }
  if (view === 'syncing') {
    return '已进房，同步身份中…'
  }
  if (view === 'solo-ready') {
    return `你是${aboutLabel(who)} · 机器人已加入`
  }
  if (peerWho) {
    return solo
      ? `你是${aboutLabel(who)} · 机器人已加入`
      : `你是${aboutLabel(who)} · 对方${aboutLabel(peerWho)}`
  }
  return `你是${aboutLabel(who)}`
}

export function hubRoomStatusLine(opts: {
  view: HubRoomView
  isHost: boolean
  solo: boolean
}): string {
  switch (opts.view) {
    case 'spectate':
      return '你是旁观，不能开局。对战两人选游戏后你仍留在这里。'
    case 'wait-peer':
      return '对方打开小游戏，从在线列表点进同一间常驻房即可。也可先加机器人下五子棋。'
    case 'syncing':
      return opts.isHost ? '正在恢复房间…' : '正在对齐身份，请稍等…'
    case 'solo-ready':
      return opts.isHost
        ? '机器人已就位，选五子棋开下一局'
        : '等先到的人选游戏'
    case 'host-ready':
      return '选一个游戏，对方会自动跟着进'
    case 'guest-ready':
      return '等待房主开始游戏'
  }
}

/** 中继角色：前两席 host/guest，其后 spectator（与 Worker pickRoomRole 一致） */
export function pickRelayRole(liveRoles: Array<'host' | 'guest' | 'spectator'>): {
  role: 'host' | 'guest' | 'spectator'
} {
  const hasHost = liveRoles.includes('host')
  const hasGuest = liveRoles.includes('guest')
  if (!hasHost) return { role: 'host' }
  if (!hasGuest) return { role: 'guest' }
  return { role: 'spectator' }
}
