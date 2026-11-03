import { aboutLabel, otherAbout, type NoteAbout } from './notes'
import { peerGameTitle, type PeerPlayGameId } from './peerRoomSave'

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

/**
 * 大厅收到 hub-pick。
 * 旁观也跟进（上帝视角只看不玩）；
 * parked 只挡住「同一局的静默补拉」；房主主动 pull（大厅点选）应跟随。
 * 进房窗口内的 pick 由调用方暂存，不再走这里的 entering 忽略。
 */
export function decideHubPick(opts: {
  isSpectator: boolean
  entering: boolean
  parkedGame: string | null | undefined
  /** 这次要进的游戏；与 parked 相同时才忽略 */
  pickGame?: string | null
  /** 房主主动点选广播：覆盖 parked */
  pull?: boolean
}): HubPickDecision {
  if (opts.entering) return { action: 'ignore', reason: 'entering' }
  // 旁观跟进；不再因 isSpectator 忽略
  if (
    !opts.isSpectator &&
    !opts.pull &&
    opts.parkedGame &&
    opts.pickGame &&
    opts.parkedGame === opts.pickGame
  ) {
    return { action: 'ignore', reason: 'parked' }
  }
  return { action: 'follow' }
}

/** 进房过程中又收到更新的 hub-pick 时，最终跟最新目标 */
export function resolveEnterGameTarget<T extends string>(
  requested: T,
  pendingLatest: T | null | undefined,
): T {
  return pendingLatest ?? requested
}

/**
 * 对局页收到 hub-pick：同游戏 → re-pick 重同步；换游戏 → 跟进导航。
 * pickId 用于识别房主新一次选择，避免洪水重复包打成多次 re-pick。
 */
export function decideGamePageHubPick(opts: {
  hereGame?: string
  pickGame: string
  pickId?: number
  lastAppliedPickId: number
  lastSameRepickAt: number
  now: number
  debounceMs?: number
}): 'repick' | 'follow' | 'ignore' {
  const pickId =
    typeof opts.pickId === 'number' && Number.isFinite(opts.pickId)
      ? opts.pickId
      : 0
  if (pickId > 0 && pickId <= opts.lastAppliedPickId) return 'ignore'
  if (opts.hereGame && opts.pickGame === opts.hereGame) {
    const debounce = opts.debounceMs ?? 600
    if (pickId <= 0 && opts.now - opts.lastSameRepickAt < debounce) {
      return 'ignore'
    }
    return 'repick'
  }
  return 'follow'
}

/** 对方当前在哪：大厅 / 某游戏 / 尚不清楚 */
export type PeerWhere = 'hub' | PeerPlayGameId | null

/**
 * 自己回大厅后的「继续游戏」门禁。
 * 对方还在对局里时不会发 hub-hello，peerWho 可能为空；
 * 只要 Peer 通道还开着（或人机），就应允许点回去。
 * 双方都已回大厅（peerWhere=hub）时不应再显示继续——由调用方清掉 parked。
 */
export function canResumeParkedGame(opts: {
  busy: boolean
  solo: boolean
  peerWho: NoteAbout | null
  connOpen: boolean
  peerWhere?: PeerWhere
}): boolean {
  if (opts.busy) return false
  if (opts.peerWhere === 'hub') return false
  if (opts.solo) return true
  if (opts.peerWho) return true
  return opts.connOpen
}

/**
 * 点加入/继续要不要广播 hub-pick。
 * 仅当对方仍在同一局时才拉人；对方已回大厅或进了别的游戏 → 只自己走。
 */
export function shouldAnnounceResume(opts: {
  solo: boolean
  targetGame: string
  peerWhere: PeerWhere
}): boolean {
  if (opts.solo) return false
  return opts.peerWhere === opts.targetGame
}

export type JoinOffer =
  | { game: PeerPlayGameId; kind: 'join-peer' }
  | { game: PeerPlayGameId; kind: 'resume-parked' }

/**
 * 大厅主按钮：优先「加入对方正在玩的」，否则才是自己的 parked 继续。
 * 双方都在大厅 → 无 offer，听房主开新局。
 */
export function resolveJoinOffer(opts: {
  peerWhere: PeerWhere
  parkedGame: PeerPlayGameId | null | undefined
}): JoinOffer | null {
  const { peerWhere, parkedGame } = opts
  if (peerWhere === 'hub') return null
  if (peerWhere) {
    return { game: peerWhere, kind: 'join-peer' }
  }
  if (parkedGame) return { game: parkedGame, kind: 'resume-parked' }
  return null
}

export function joinOfferLabel(offer: JoinOffer): string {
  const title = peerGameTitle(offer.game)
  return offer.kind === 'join-peer' ? `加入${title}` : `继续${title}`
}

export function joinOfferHint(offer: JoinOffer): string {
  if (offer.kind === 'join-peer') return '对方正在玩，点此加入'
  return '回到刚才那局 · 本机进度约保留 24 小时'
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
  /** 已有加入/续局入口时，状态行交给按钮下方 hint，避免「等待开始」与「对方正在玩」打架 */
  joinOffer?: JoinOffer | null
}): string {
  if (opts.joinOffer) return ''
  switch (opts.view) {
    case 'spectate':
      return '你是旁观（上帝视角）。对战两人开局后你会跟着进，只看不玩。'
    case 'wait-peer':
      return '把小游戏链接发给对方，对方从在线列表点进同一间即可。也可先加机器人下五子棋。'
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

/**
 * 房主点格子进游戏：真人房一律广播 hub-pick（带 pull）。
 * 不再用 shouldAnnounceResume：续旧局不广播会让客人停在大厅。
 */
export function shouldAnnounceHostPick(opts: { solo: boolean }): boolean {
  return !opts.solo
}

/**
 * 连切合并：间隔 < debounceMs 的 pick 只落地最后一次。
 * 对齐 withHubNav 的 120ms 导航合并。
 */
export function coalesceRapidPicks(
  picks: Array<{ game: string; at: number }>,
  debounceMs = 120,
): string[] {
  if (!picks.length) return []
  const landed: string[] = []
  let pending = picks[0]!.game
  let lastAt = picks[0]!.at
  for (let i = 1; i < picks.length; i++) {
    const p = picks[i]!
    if (p.at - lastAt >= debounceMs) landed.push(pending)
    pending = p.game
    lastAt = p.at
  }
  landed.push(pending)
  return landed
}

/** WS 关闭后是否还应自动重连（拒旁观/满员/被顶/到期 → 否） */
export function shouldWsAutoReconnect(
  closeCode: number,
  reason = '',
): boolean {
  if (closeCode === 4001 || reason === 'room-expired') return false
  if (closeCode === 4000 || reason === 'room-full') return false
  if (closeCode === 4002 || reason === 'no-spectators') return false
  if (closeCode === 4003 || reason === 'replaced') return false
  return true
}

/** 客人跟进状态（回测用，对齐大厅 + 对局页 hub-pick 决策） */
export type GuestFollowState = {
  where: 'hub' | string
  parked: string | null
  entering: boolean
  pendingPick: string | null
  lastAppliedPickId: number
  lastSameRepickAt: number
  /** 对局页是否需要 re-pick 重同步（如德州 wait） */
  needsRepick: boolean
}

export type HubPickWire = {
  game: string
  pickId: number
  pull?: boolean
  at: number
}

/**
 * 客人收到一条 hub-pick 后的状态迁移。
 * entering 时只暂存；大厅走 decideHubPick；对局页走 decideGamePageHubPick。
 */
export function reduceGuestHubPick(
  state: GuestFollowState,
  pick: HubPickWire,
): { state: GuestFollowState; action: string } {
  if (state.entering) {
    return {
      state: { ...state, pendingPick: pick.game },
      action: 'pending',
    }
  }

  if (state.where === 'hub') {
    const decision = decideHubPick({
      isSpectator: false,
      entering: false,
      parkedGame: state.parked,
      pickGame: pick.game,
      pull: !!pick.pull,
    })
    if (decision.action === 'ignore') {
      return { state, action: `ignore:${decision.reason}` }
    }
    const target = resolveEnterGameTarget(pick.game, state.pendingPick)
    return {
      state: {
        ...state,
        where: target,
        parked: null,
        pendingPick: null,
        entering: false,
        lastAppliedPickId: Math.max(state.lastAppliedPickId, pick.pickId),
        needsRepick: false,
      },
      action: `follow:${target}`,
    }
  }

  const page = decideGamePageHubPick({
    hereGame: state.where,
    pickGame: pick.game,
    pickId: pick.pickId,
    lastAppliedPickId: state.lastAppliedPickId,
    lastSameRepickAt: state.lastSameRepickAt,
    now: pick.at,
  })
  if (page === 'ignore') return { state, action: 'ignore:dup' }
  if (page === 'repick') {
    return {
      state: {
        ...state,
        lastAppliedPickId: Math.max(state.lastAppliedPickId, pick.pickId),
        lastSameRepickAt: pick.at,
        needsRepick: true,
        parked: null,
      },
      action: `repick:${pick.game}`,
    }
  }
  return {
    state: {
      ...state,
      where: pick.game,
      parked: null,
      lastAppliedPickId: Math.max(state.lastAppliedPickId, pick.pickId),
      needsRepick: false,
    },
    action: `follow:${pick.game}`,
  }
}

/** 进房结束：若有 pending 则改跟最新 */
export function finishGuestEnter(
  state: GuestFollowState,
  requested: string,
): GuestFollowState {
  const target = resolveEnterGameTarget(requested, state.pendingPick)
  return {
    ...state,
    where: target,
    pendingPick: null,
    entering: false,
    parked: null,
    needsRepick: false,
  }
}
