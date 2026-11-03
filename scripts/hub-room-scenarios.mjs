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
  if (opts.isSpectator) return { action: 'ignore', reason: 'spectator' }
  if (opts.entering) return { action: 'ignore', reason: 'entering' }
  if (opts.parkedGame) return { action: 'ignore', reason: 'parked' }
  return { action: 'follow' }
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
  switch (opts.view) {
    case 'spectate':
      return '你是旁观，不能开局。对战两人选游戏后你仍留在这里。'
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
    decideHubPick({ isSpectator: false, entering: false, parkedGame: null })
      .action === 'follow',
  )
  assert(
    '旁观忽略',
    decideHubPick({ isSpectator: true, entering: false, parkedGame: null })
      .reason === 'spectator',
  )
  assert(
    '已回大厅 parked 忽略（等点继续）',
    decideHubPick({
      isSpectator: false,
      entering: false,
      parkedGame: 'gomoku',
    }).reason === 'parked',
  )
  assert(
    '正在进游戏忽略',
    decideHubPick({ isSpectator: false, entering: true, parkedGame: null })
      .reason === 'entering',
  )
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
    'C 不能跟 pick',
    decideHubPick({
      isSpectator: true,
      entering: false,
      parkedGame: null,
    }).action === 'ignore',
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

console.log('\n=== 9. 奇怪 case：回大厅后不该被 hub-pick 强拉 ===')
{
  const d = decideHubPick({
    isSpectator: false,
    entering: false,
    parkedGame: 'gomoku',
  })
  assert('parked 时忽略强拉', d.action === 'ignore' && d.reason === 'parked')
  const d2 = decideHubPick({
    isSpectator: false,
    entering: false,
    parkedGame: null,
  })
  assert('无 parked 可跟进', d2.action === 'follow')
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
}

console.log(`\n—— 结果：${passed} 通过，${failed} 失败 ——\n`)
process.exit(failed ? 1 : 0)
