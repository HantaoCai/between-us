/**
 * 开房 / 入座 / hello / 选游戏门禁 回测（与 src/lib/hubRoom.ts 对齐）。
 * 跑：npm run test:hub
 *
 * 故意自包含：不依赖 Vite/TS 解析，避免 Node ESM 扩展名问题。
 * 若改 hubRoom.ts，请同步改这里的纯函数并再跑一遍。
 */

function aboutLabel(about) {
  return about === 'me' ? '铁憨憨' : '软绵绵'
}
function otherAbout(about) {
  return about === 'her' ? 'me' : 'her'
}

function seatModeForPeers(peers) {
  if (peers <= 0) return 'pick'
  if (peers === 1) return 'auto-other'
  return 'spectate'
}

function enterLabelForPeers(peers) {
  if (peers <= 0) return '进入房间'
  if (peers === 1) return '加入（自动另一边）'
  return '旁观进入'
}

function lobbyHintForMode(mode, who) {
  if (mode === 'pick') return `对方进房后自动是 ${aboutLabel(otherAbout(who))}。`
  if (mode === 'spectate') return '对战席已满，进来只能旁观。'
  return '房里已有一人，进房后自动成为另一边。'
}

function resolveHubHello(state, msg) {
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
    return {
      ignore: false,
      who: state.who,
      peerWho: peer,
      replyHello: state.peerWho !== peer,
    }
  }
  const hostWho = msg.who
  return {
    ignore: false,
    who: otherAbout(hostWho),
    peerWho: hostWho,
    replyHello: true,
  }
}

function decideHubPick(opts) {
  if (opts.entering) return { action: 'ignore', reason: 'entering' }
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

function resolveEnterGameTarget(requested, pendingLatest) {
  return pendingLatest ?? requested
}

function decideGamePageHubPick(opts) {
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

function shouldAnnounceHostPick(opts) {
  return !opts.solo
}

function coalesceRapidPicks(picks, debounceMs = 120) {
  if (!picks.length) return []
  const landed = []
  let pending = picks[0].game
  let lastAt = picks[0].at
  for (let i = 1; i < picks.length; i++) {
    const p = picks[i]
    if (p.at - lastAt >= debounceMs) landed.push(pending)
    pending = p.game
    lastAt = p.at
  }
  landed.push(pending)
  return landed
}

function shouldWsAutoReconnect(closeCode, reason = '') {
  if (closeCode === 4001 || reason === 'room-expired') return false
  if (closeCode === 4000 || reason === 'room-full') return false
  if (closeCode === 4002 || reason === 'no-spectators') return false
  if (closeCode === 4003 || reason === 'replaced') return false
  return true
}

function reduceGuestHubPick(state, pick) {
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

function finishGuestEnter(state, requested) {
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

function freshGuest() {
  return {
    where: 'hub',
    parked: null,
    entering: false,
    pendingPick: null,
    lastAppliedPickId: 0,
    lastSameRepickAt: 0,
    needsRepick: false,
  }
}

/** 顺序吃 pick，返回最终状态与 action 列表 */
function runGuestPicks(state, picks) {
  const actions = []
  let cur = state
  for (const pick of picks) {
    const r = reduceGuestHubPick(cur, pick)
    actions.push(r.action)
    cur = r.state
  }
  return { state: cur, actions }
}

function canResumeParkedGame(opts) {
  if (opts.busy) return false
  if (opts.peerWhere === 'hub') return false
  if (opts.solo) return true
  if (opts.peerWho) return true
  return opts.connOpen
}

function shouldAnnounceResume(opts) {
  if (opts.solo) return false
  return opts.peerWhere === opts.targetGame
}

function resolveJoinOffer(opts) {
  const { peerWhere, parkedGame } = opts
  if (peerWhere === 'hub') return null
  if (peerWhere && peerWhere !== 'hub') {
    return { game: peerWhere, kind: 'join-peer' }
  }
  if (parkedGame) return { game: parkedGame, kind: 'resume-parked' }
  return null
}

function canHostPickGame(opts) {
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

function hubRoomView(opts) {
  if (opts.isSpectator) return 'spectate'
  if (opts.solo && opts.peerWho) return 'solo-ready'
  if (!opts.peerWho) {
    if (opts.isHost && !opts.reconnecting) return 'wait-peer'
    return 'syncing'
  }
  return opts.isHost ? 'host-ready' : 'guest-ready'
}

function hubRoomDetail(opts) {
  const { view, who, peerWho, solo } = opts
  if (view === 'spectate') {
    return peerWho
      ? `旁观中 · ${aboutLabel(peerWho)}在房`
      : '旁观中 · 对战席同步中…'
  }
  if (view === 'wait-peer') {
    return `你是${aboutLabel(who)} · 等对方从列表进同一间`
  }
  if (view === 'syncing') return '已进房，同步身份中…'
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

function hubRoomStatusLine(opts) {
  if (opts.joinOffer) return ''
  switch (opts.view) {
    case 'spectate':
      return '你是旁观（上帝视角）。对战两人开局后你会跟着进，只看不玩。'
    case 'wait-peer':
      return '对方打开小游戏，从在线列表点进同一间即可。也可先加机器人下五子棋。'
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

function pickRelayRole(liveRoles) {
  const hasHost = liveRoles.includes('host')
  const hasGuest = liveRoles.includes('guest')
  if (!hasHost) return { role: 'host' }
  if (!hasGuest) return { role: 'guest' }
  return { role: 'spectator' }
}

/** 对照：从源码粗检关键文案仍在，防止 TS 改了脚本没跟上 */
async function assertSourceAligned() {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(
    new URL('../src/lib/hubRoom.ts', import.meta.url),
    'utf8',
  )
  const must = [
    'export function resolveHubHello',
    'export function decideHubPick',
    'export function canResumeParkedGame',
    'export function resolveJoinOffer',
    'export function shouldAnnounceResume',
    'export function shouldAnnounceHostPick',
    'export function coalesceRapidPicks',
    'export function shouldWsAutoReconnect',
    'export function reduceGuestHubPick',
    'export function finishGuestEnter',
    'export function canHostPickGame',
    'export function hubRoomView',
    '等对方从列表进同一间',
    'parked',
  ]
  for (const token of must) {
    if (!src.includes(token)) {
      throw new Error(`hubRoom.ts 缺少与脚本对齐的片段: ${token}`)
    }
  }
  // 扫码页相关文案不应再出现在房间状态里
  if (/扫码|二维码/.test(src)) {
    throw new Error('hubRoom.ts 仍含扫码/二维码文案，应已去掉')
  }
  const gamesPage = await readFile(
    new URL('../src/pages/GamesPage.tsx', import.meta.url),
    'utf8',
  )
  if (!gamesPage.includes('shouldAnnounceHostPick')) {
    throw new Error('GamesPage 未使用 shouldAnnounceHostPick')
  }
  // 旧坑：续同一局用 shouldAnnounceResume 导致不广播
  if (/resumingSame[\s\S]{0,200}shouldAnnounceResume/.test(gamesPage)) {
    throw new Error('GamesPage pickGame 仍用 shouldAnnounceResume 续局（应始终 HostPick）')
  }
  const wsRoom = await readFile(
    new URL('../src/lib/wsRoom.ts', import.meta.url),
    'utf8',
  )
  if (!wsRoom.includes('shouldWsAutoReconnect')) {
    throw new Error('wsRoom 未使用 shouldWsAutoReconnect')
  }
}

let passed = 0
let failed = 0

function assert(name, cond, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

await assertSourceAligned()
console.log('\n=== 源码对齐检查通过 ===')

console.log('\n=== 1. 在线人数 → 入座模式 ===')
{
  assert('0 人 pick', seatModeForPeers(0) === 'pick')
  assert('1 人 auto-other', seatModeForPeers(1) === 'auto-other')
  assert('2 人 spectate', seatModeForPeers(2) === 'spectate')
  assert('3 人 spectate', seatModeForPeers(3) === 'spectate')
  assert('空房文案', enterLabelForPeers(0) === '进入房间')
  assert('一人文案', enterLabelForPeers(1).includes('另一边'))
  assert('满员文案', enterLabelForPeers(2).includes('旁观'))
  assert('hint pick 含对侧', lobbyHintForMode('pick', 'her').includes('铁憨憨'))
}

console.log('\n=== 2. 中继角色分配（与 Worker 一致）===')
{
  assert('空房 → host', pickRelayRole([]).role === 'host')
  assert('已有 host → guest', pickRelayRole(['host']).role === 'guest')
  assert(
    'host+guest → spectator',
    pickRelayRole(['host', 'guest']).role === 'spectator',
  )
  assert('host 掉线后新进 → host', pickRelayRole(['guest']).role === 'host')
  assert(
    '多人旁观仍 spectator',
    pickRelayRole(['host', 'guest', 'spectator']).role === 'spectator',
  )
}

console.log('\n=== 3. hub-hello：0→1→2 人对齐身份 ===')
{
  const host0 = {
    who: 'her',
    peerWho: null,
    isHost: true,
    isSpectator: false,
  }
  const guestHello = resolveHubHello(host0, {
    type: 'hub-hello',
    who: 'me',
    seat: 'player',
  })
  assert(
    '房主收到客人 hello → peerWho=me 对侧',
    guestHello.peerWho === 'me' && guestHello.who === 'her' && !guestHello.ignore,
  )
  assert('房主首次见到对方要回 hello', guestHello.replyHello === true)

  const hostAgain = resolveHubHello(
    { ...host0, peerWho: 'me' },
    { type: 'hub-hello', who: 'me', seat: 'player' },
  )
  assert('房主已对齐后不再强制回 hello', hostAgain.replyHello === false)

  const guest0 = {
    who: 'her',
    peerWho: null,
    isHost: false,
    isSpectator: false,
  }
  const fromHost = resolveHubHello(guest0, {
    type: 'hub-hello',
    who: 'her',
    seat: 'player',
  })
  assert(
    '客人被房主 hello 切到对侧 me',
    fromHost.who === 'me' && fromHost.peerWho === 'her',
  )
  assert('客人要回 hello', fromHost.replyHello === true)
}

console.log('\n=== 4. 旁观 hello 不占席 ===')
{
  const host = {
    who: 'her',
    peerWho: 'me',
    isHost: true,
    isSpectator: false,
  }
  const fromSpec = resolveHubHello(host, {
    type: 'hub-hello',
    who: 'me',
    seat: 'spectator',
  })
  assert('对战席忽略旁观 hello', fromSpec.ignore === true)
  assert('peerWho 不变', fromSpec.peerWho === 'me')
  assert('房主仍可回 hello 给旁观对齐', fromSpec.replyHello === true)

  const spec = {
    who: 'her',
    peerWho: null,
    isHost: false,
    isSpectator: true,
  }
  const seeHost = resolveHubHello(spec, {
    type: 'hub-hello',
    who: 'her',
    seat: 'player',
  })
  assert('旁观记下对战身份', seeHost.peerWho === 'her' && !seeHost.ignore)

  const seeSpec = resolveHubHello(spec, {
    type: 'hub-hello',
    who: 'me',
    seat: 'spectator',
  })
  assert('旁观忽略另一旁观', seeSpec.ignore === true)
}

console.log('\n=== 5. hub-pick 决策 ===')
{
  assert(
    '正常跟进',
    decideHubPick({
      isSpectator: false,
      entering: false,
      parkedGame: null,
      pickGame: 'dice',
    }).action === 'follow',
  )
  assert(
    '旁观跟进',
    decideHubPick({
      isSpectator: true,
      entering: false,
      parkedGame: null,
      pickGame: 'dice',
    }).action === 'follow',
  )
  assert(
    '同局 parked 忽略（等点加入）',
    decideHubPick({
      isSpectator: false,
      entering: false,
      parkedGame: 'gomoku',
      pickGame: 'gomoku',
    }).reason === 'parked',
  )
  assert(
    '房主开了别的游戏应跟随',
    decideHubPick({
      isSpectator: false,
      entering: false,
      parkedGame: 'poker',
      pickGame: 'guess',
    }).action === 'follow',
  )
  assert(
    '正在进游戏忽略',
    decideHubPick({
      isSpectator: false,
      entering: true,
      parkedGame: null,
      pickGame: 'dice',
    }).reason === 'entering',
  )
  assert(
    '房主主动 pull 覆盖 parked',
    decideHubPick({
      isSpectator: false,
      entering: false,
      parkedGame: 'poker',
      pickGame: 'poker',
      pull: true,
    }).action === 'follow',
  )
}

console.log('\n=== 5b. 连切 / 同游戏 re-pick ===')
{
  assert(
    '进房中改跟最新 pick',
    resolveEnterGameTarget('poker', 'draw') === 'draw',
  )
  assert(
    '无 pending 仍跟原目标',
    resolveEnterGameTarget('poker', null) === 'poker',
  )
  assert(
    '同游戏 hub-pick 要 re-pick',
    decideGamePageHubPick({
      hereGame: 'poker',
      pickGame: 'poker',
      pickId: 3,
      lastAppliedPickId: 2,
      lastSameRepickAt: 0,
      now: 1000,
    }) === 'repick',
  )
  assert(
    '旧 pickId 忽略',
    decideGamePageHubPick({
      hereGame: 'poker',
      pickGame: 'poker',
      pickId: 2,
      lastAppliedPickId: 2,
      lastSameRepickAt: 0,
      now: 1000,
    }) === 'ignore',
  )
  assert(
    '换游戏跟进',
    decideGamePageHubPick({
      hereGame: 'poker',
      pickGame: 'draw',
      pickId: 4,
      lastAppliedPickId: 3,
      lastSameRepickAt: 0,
      now: 1000,
    }) === 'follow',
  )
  assert(
    '无 pickId 洪水去抖',
    decideGamePageHubPick({
      hereGame: 'poker',
      pickGame: 'poker',
      lastAppliedPickId: 0,
      lastSameRepickAt: 900,
      now: 1000,
    }) === 'ignore',
  )
}

console.log('\n=== 5c. 房主点格子必须广播（复现「点格子续 poker」无 hub-pick）===')
{
  assert(
    '真人房点格子要广播',
    shouldAnnounceHostPick({ solo: false }) === true,
  )
  assert(
    '人机不广播',
    shouldAnnounceHostPick({ solo: true }) === false,
  )
  // 旧逻辑：parked/续局 + peerWhere≠poker → 不广播（日志 01:56:50）
  const legacyWouldAnnounce = shouldAnnounceResume({
    solo: false,
    targetGame: 'poker',
    peerWhere: 'hub',
  })
  assert('旧续局逻辑在大厅会漏广播', legacyWouldAnnounce === false)
  assert(
    '新 HostPick 即使对方在大厅也广播',
    shouldAnnounceHostPick({ solo: false }) === true,
  )
}

console.log('\n=== 5d. 日志回放：房主连切 draw→poker→guess→draw→poker ===')
{
  // 对齐客人日志 01:45:15–22（时间戳压成相对 ms）
  const burst = [
    { game: 'draw', at: 0 },
    { game: 'poker', at: 4028 },
    { game: 'guess', at: 4042 },
    { game: 'draw', at: 5763 },
    { game: 'poker', at: 6478 },
  ]
  const landed = coalesceRapidPicks(burst, 120)
  assert(
    '连切合并后最终停在 poker',
    landed[landed.length - 1] === 'poker',
  )
  assert(
    '合并后落地次数少于原始 pick',
    landed.length < burst.length,
  )

  // 客人已在 draw，再吃后面几条（对局页路径）
  let guest = {
    ...freshGuest(),
    where: 'draw',
    lastAppliedPickId: 1,
  }
  const mid = runGuestPicks(guest, [
    { game: 'poker', pickId: 2, pull: true, at: 4028 },
    { game: 'guess', pickId: 3, pull: true, at: 4042 },
    { game: 'draw', pickId: 4, pull: true, at: 5763 },
    { game: 'poker', pickId: 5, pull: true, at: 6478 },
  ])
  assert('连切后客人 where=poker', mid.state.where === 'poker')
  assert(
    '中间发生过跟进',
    mid.actions.some((a) => a.startsWith('follow:')),
  )

  // 房主再次点同一款 poker（补发 pickId=6）：应 re-pick，不能 silent ignore
  const again = reduceGuestHubPick(mid.state, {
    game: 'poker',
    pickId: 6,
    pull: true,
    at: 8000,
  })
  assert('同游戏再选 → repick', again.action === 'repick:poker')
  assert('repick 标记 needsRepick', again.state.needsRepick === true)
}

console.log('\n=== 5e. 日志回放：回大厅 parked 挡拉人（01:47:39）===')
{
  const parked = {
    ...freshGuest(),
    where: 'hub',
    parked: 'poker',
  }
  const silent = reduceGuestHubPick(parked, {
    game: 'poker',
    pickId: 10,
    at: 1000,
  })
  assert(
    '静默补拉仍 ignore parked',
    silent.action === 'ignore:parked',
  )
  const pulled = reduceGuestHubPick(parked, {
    game: 'poker',
    pickId: 11,
    pull: true,
    at: 1001,
  })
  assert(
    '房主主动 pull 覆盖 parked → 跟进 poker',
    pulled.action === 'follow:poker' && pulled.state.where === 'poker',
  )
}

console.log('\n=== 5f. 进房窗口连切：先 draw 进房中又来 poker ===')
{
  let g = { ...freshGuest(), entering: true }
  const r1 = reduceGuestHubPick(g, {
    game: 'poker',
    pickId: 2,
    pull: true,
    at: 100,
  })
  assert('进房中暂存', r1.action === 'pending' && r1.state.pendingPick === 'poker')
  g = finishGuestEnter(r1.state, 'draw')
  assert('结束进房改跟最新 poker', g.where === 'poker')
  assert('pending 已清', g.pendingPick === null)
}

console.log('\n=== 5g. 房主日志 01:56：续 poker 必须 announce ===')
{
  // 房主有 stale parked、peerWhere=hub，点格子续 poker
  const gate = canHostPickGame({
    isHost: true,
    isSpectator: false,
    busy: false,
    picking: false,
    entering: false,
    who: 'her',
    peerWho: 'me',
    connOpen: true,
    solo: false,
    game: 'poker',
  })
  assert('双方就绪可点格子', gate.ok === true)
  const announce = shouldAnnounceHostPick({ solo: false })
  assert('续 poker 也要广播', announce === true)

  // 客人侧：收到带 pull 的广播后离开 parked
  const guest = reduceGuestHubPick(
    { ...freshGuest(), parked: 'poker' },
    { game: 'poker', pickId: 1, pull: true, at: 0 },
  )
  assert(
    '客人被 pull 进 poker',
    guest.action === 'follow:poker' && guest.state.parked === null,
  )
}

console.log('\n=== 5h. WS 拒连不应空转重连（01:49 风暴）===')
{
  assert('网络闪断可重连', shouldWsAutoReconnect(1006, '') === true)
  assert('到期不重连', shouldWsAutoReconnect(4001, 'room-expired') === false)
  assert('满员不重连', shouldWsAutoReconnect(4000, 'room-full') === false)
  assert(
    '不许旁观不重连',
    shouldWsAutoReconnect(4002, 'no-spectators') === false,
  )
  assert('被顶替不重连', shouldWsAutoReconnect(4003, 'replaced') === false)
}

console.log('\n=== 5i. 场景矩阵：客人最终 where 必须等于房主最后一局 ===')
{
  const cases = [
    {
      name: '单次开局 poker',
      picks: [{ game: 'poker', pickId: 1, pull: true, at: 0 }],
      expect: 'poker',
    },
    {
      name: 'poker→guess',
      picks: [
        { game: 'poker', pickId: 1, pull: true, at: 0 },
        { game: 'guess', pickId: 2, pull: true, at: 500 },
      ],
      expect: 'guess',
    },
    {
      name: 'guess→poker→guess→poker',
      picks: [
        { game: 'guess', pickId: 1, pull: true, at: 0 },
        { game: 'poker', pickId: 2, pull: true, at: 400 },
        { game: 'guess', pickId: 3, pull: true, at: 800 },
        { game: 'poker', pickId: 4, pull: true, at: 1200 },
      ],
      expect: 'poker',
    },
    {
      name: '同局再选仍停在 poker 且 needsRepick',
      picks: [
        { game: 'poker', pickId: 1, pull: true, at: 0 },
        { game: 'poker', pickId: 2, pull: true, at: 2000 },
      ],
      expect: 'poker',
      needsRepick: true,
    },
  ]
  for (const c of cases) {
    const { state } = runGuestPicks(freshGuest(), c.picks)
    assert(`${c.name} → ${c.expect}`, state.where === c.expect)
    if (c.needsRepick) {
      assert(`${c.name} needsRepick`, state.needsRepick === true)
    }
  }
}

console.log('\n=== 6. 房主选游戏门禁 ===')
{
  const base = {
    isHost: true,
    isSpectator: false,
    busy: false,
    picking: false,
    entering: false,
    who: 'her',
    peerWho: 'me',
    connOpen: true,
    solo: false,
    game: 'gomoku',
  }
  assert('双方就绪可开', canHostPickGame(base).ok === true)
  assert(
    '无对方不可开',
    canHostPickGame({ ...base, peerWho: null }).ok === false,
  )
  assert(
    '身份撞车不可开',
    canHostPickGame({ ...base, peerWho: 'her' }).ok === false,
  )
  assert(
    '未连上不可开',
    canHostPickGame({ ...base, connOpen: false }).ok === false,
  )
  assert(
    '客人不可开',
    canHostPickGame({ ...base, isHost: false }).ok === false,
  )
  assert(
    '旁观不可开',
    canHostPickGame({ ...base, isSpectator: true }).ok === false,
  )
  assert(
    '人机只能五子棋',
    canHostPickGame({ ...base, solo: true, game: 'dice', connOpen: false })
      .ok === false,
  )
  assert(
    '人机五子棋可开（无需 conn）',
    canHostPickGame({ ...base, solo: true, game: 'gomoku', connOpen: false })
      .ok === true,
  )
}

console.log('\n=== 7. 房间页视图分流（无扫码页）===')
{
  const wait = hubRoomView({
    isSpectator: false,
    isHost: true,
    peerWho: null,
    solo: false,
    reconnecting: false,
  })
  assert('房主等对方 → wait-peer', wait === 'wait-peer')
  assert(
    '等对方文案不含扫码/二维码',
    !hubRoomStatusLine({ view: wait, isHost: true, solo: false }).includes(
      '扫',
    ) &&
      !hubRoomDetail({
        view: wait,
        who: 'her',
        peerWho: null,
        solo: false,
      }).includes('扫'),
  )
  assert(
    '提示走列表进房',
    hubRoomStatusLine({ view: wait, isHost: true, solo: false }).includes(
      '列表',
    ),
  )

  assert(
    '客人同步中 → syncing',
    hubRoomView({
      isSpectator: false,
      isHost: false,
      peerWho: null,
      solo: false,
      reconnecting: true,
    }) === 'syncing',
  )
  assert(
    '房主就绪 → host-ready',
    hubRoomView({
      isSpectator: false,
      isHost: true,
      peerWho: 'me',
      solo: false,
      reconnecting: false,
    }) === 'host-ready',
  )
  assert(
    '客人就绪 → guest-ready',
    hubRoomView({
      isSpectator: false,
      isHost: false,
      peerWho: 'her',
      solo: false,
      reconnecting: false,
    }) === 'guest-ready',
  )
  assert(
    '旁观 → spectate',
    hubRoomView({
      isSpectator: true,
      isHost: false,
      peerWho: 'her',
      solo: false,
      reconnecting: false,
    }) === 'spectate',
  )
  assert(
    '人机 → solo-ready',
    hubRoomView({
      isSpectator: false,
      isHost: true,
      peerWho: 'me',
      solo: true,
      reconnecting: false,
    }) === 'solo-ready',
  )
}

console.log('\n=== 8. 场景串联：三人入座 ===')
{
  const roles = []
  const a = pickRelayRole(roles).role
  roles.push(a)
  const b = pickRelayRole(roles).role
  roles.push(b)
  const c = pickRelayRole(roles).role
  roles.push(c)
  assert(
    'A=host B=guest C=spectator',
    eq([a, b, c], ['host', 'guest', 'spectator']),
  )

  let hostState = {
    who: 'her',
    peerWho: null,
    isHost: true,
    isSpectator: false,
  }
  let guestState = {
    who: 'her',
    peerWho: null,
    isHost: false,
    isSpectator: false,
  }
  const h1 = resolveHubHello(hostState, {
    type: 'hub-hello',
    who: guestState.who,
    seat: 'player',
  })
  hostState = { ...hostState, who: h1.who, peerWho: h1.peerWho }
  const g1 = resolveHubHello(guestState, {
    type: 'hub-hello',
    who: hostState.who,
    seat: 'player',
  })
  guestState = { ...guestState, who: g1.who, peerWho: g1.peerWho }

  assert('A 仍是 her', hostState.who === 'her' && hostState.peerWho === 'me')
  assert('B 变成 me', guestState.who === 'me' && guestState.peerWho === 'her')
  assert(
    '两边身份互补',
    hostState.who !== guestState.who &&
      hostState.peerWho === guestState.who &&
      guestState.peerWho === hostState.who,
  )

  const specState = {
    who: 'her',
    peerWho: null,
    isHost: false,
    isSpectator: true,
  }
  const s1 = resolveHubHello(specState, {
    type: 'hub-hello',
    who: 'her',
    seat: 'player',
  })
  assert('C 旁观看到 A', s1.peerWho === 'her')
  assert(
    'C 旁观可跟 pick',
    decideHubPick({
      isSpectator: true,
      entering: false,
      parkedGame: null,
      pickGame: 'dice',
    }).action === 'follow',
  )
  assert(
    'A 可开局',
    canHostPickGame({
      isHost: true,
      isSpectator: false,
      busy: false,
      picking: false,
      entering: false,
      who: hostState.who,
      peerWho: hostState.peerWho,
      connOpen: true,
      solo: false,
      game: 'dice',
    }).ok === true,
  )
}

console.log('\n=== 9. 奇怪 case：回大厅后不该被同局 hub-pick 强拉 ===')
{
  const d = decideHubPick({
    isSpectator: false,
    entering: false,
    parkedGame: 'gomoku',
    pickGame: 'gomoku',
  })
  assert('同局 parked 忽略强拉', d.action === 'ignore' && d.reason === 'parked')
  const d2 = decideHubPick({
    isSpectator: false,
    entering: false,
    parkedGame: 'poker',
    pickGame: 'guess',
  })
  assert('新游戏可跟进', d2.action === 'follow')
}

console.log('\n=== 9b. 加入/继续门禁与 offer ===')
{
  assert(
    '有 peerWho 可继续',
    canResumeParkedGame({
      busy: false,
      solo: false,
      peerWho: 'me',
      connOpen: false,
    }) === true,
  )
  assert(
    '无 peerWho 但通道开着可继续（对方在对局）',
    canResumeParkedGame({
      busy: false,
      solo: false,
      peerWho: null,
      connOpen: true,
    }) === true,
  )
  assert(
    '双方都在大厅不可继续旧局',
    canResumeParkedGame({
      busy: false,
      solo: false,
      peerWho: 'me',
      connOpen: true,
      peerWhere: 'hub',
    }) === false,
  )
  assert(
    '掉线且无 peerWho 不可继续',
    canResumeParkedGame({
      busy: false,
      solo: false,
      peerWho: null,
      connOpen: false,
    }) === false,
  )
  assert(
    '人机可继续',
    canResumeParkedGame({
      busy: false,
      solo: true,
      peerWho: null,
      connOpen: false,
    }) === true,
  )
  assert(
    '忙碌不可继续',
    canResumeParkedGame({
      busy: true,
      solo: false,
      peerWho: 'me',
      connOpen: true,
    }) === false,
  )
  assert(
    '对方在猜数字 → 加入猜数字',
    resolveJoinOffer({ peerWhere: 'guess', parkedGame: 'poker' })?.kind ===
      'join-peer' &&
      resolveJoinOffer({ peerWhere: 'guess', parkedGame: 'poker' })?.game ===
        'guess',
  )
  assert(
    '有加入 offer 时不写「等待房主开始」',
    hubRoomStatusLine({
      view: 'guest-ready',
      isHost: false,
      solo: false,
      joinOffer: { game: 'poker', kind: 'join-peer' },
    }) === '',
  )
  assert(
    '无 offer 客人仍提示等待开始',
    hubRoomStatusLine({
      view: 'guest-ready',
      isHost: false,
      solo: false,
      joinOffer: null,
    }).includes('等待房主'),
  )
  assert(
    '双方大厅无 offer',
    resolveJoinOffer({ peerWhere: 'hub', parkedGame: 'poker' }) === null,
  )
  assert(
    '仅 parked → resume',
    resolveJoinOffer({ peerWhere: null, parkedGame: 'poker' })?.kind ===
      'resume-parked',
  )
  assert(
    '对方同局才广播继续',
    shouldAnnounceResume({
      solo: false,
      targetGame: 'poker',
      peerWhere: 'poker',
    }) === true,
  )
  assert(
    '对方已在别局不广播',
    shouldAnnounceResume({
      solo: false,
      targetGame: 'poker',
      peerWhere: 'guess',
    }) === false,
  )
}

console.log('\n=== 10. GamesPage 不应再挂扫码组件 ===')
{
  const { readFile } = await import('node:fs/promises')
  const page = await readFile(
    new URL('../src/pages/GamesPage.tsx', import.meta.url),
    'utf8',
  )
  assert('无 RoomInvite import', !page.includes('RoomInvite'))
  assert('无「正在进房…」大厅插页', !page.includes('马上就好'))
  assert('无自动进房 key', !page.includes('autoJoinKeyRef'))
  assert('用 hubRoomView 分流', page.includes('hubRoomView'))
  assert('有加入 offer', page.includes('resolveJoinOffer'))
}

console.log('\n=== 11. 本机房间存档 TTL 24h ===')
{
  const { readFile } = await import('node:fs/promises')
  const save = await readFile(
    new URL('../src/lib/peerRoomSave.ts', import.meta.url),
    'utf8',
  )
  assert(
    'PEER_ROOM_TTL_MS = 24h',
    save.includes('PEER_ROOM_TTL_MS = 24 * 60 * 60 * 1000'),
  )
  const worker = await readFile(
    new URL('../workers/cloud/worker.js', import.meta.url),
    'utf8',
  )
  assert('中继有 activeGame', worker.includes('ROOM_GAME_KEY'))
  assert(
    '人走光立刻清寿命',
    worker.includes('人走光：立刻解散本轮'),
  )
  assert(
    '对战席进房才刷新 24h',
    worker.includes('仅对战席（host/guest）入场刷新 24h'),
  )
  assert(
    '默认不允许旁观',
    worker.includes('ROOM_ALLOW_SPEC_KEY') &&
      worker.includes('reject-no-spectators'),
  )
}

console.log(`\n—— 结果：${passed} 通过，${failed} 失败 ——\n`)
process.exit(failed ? 1 : 0)
