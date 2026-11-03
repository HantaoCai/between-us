/**
 * 开房 / 入座 / hello / 选游戏门禁 回测。
 * 跑：node --experimental-strip-types scripts/hub-room-scenarios.mjs
 * （直接读 src/lib/hubRoom.ts，与线上同一套纯逻辑）
 */
import {
  canHostPickGame,
  decideHubPick,
  enterLabelForPeers,
  hubRoomDetail,
  hubRoomStatusLine,
  hubRoomView,
  lobbyHintForMode,
  pickRelayRole,
  resolveHubHello,
  seatModeForPeers,
} from '../src/lib/hubRoom.ts'

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

console.log('\n=== 1. 在线人数 → 入座模式 ===')
{
  assert('0 人 pick', seatModeForPeers(0) === 'pick')
  assert('1 人 auto-other', seatModeForPeers(1) === 'auto-other')
  assert('2 人 spectate', seatModeForPeers(2) === 'spectate')
  assert('3 人 spectate', seatModeForPeers(3) === 'spectate')
  assert('空房文案', enterLabelForPeers(0) === '进入常驻房间')
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
  assert(
    'host 掉线后新进 → host',
    pickRelayRole(['guest']).role === 'host',
  )
  assert(
    '多人旁观仍 spectator',
    pickRelayRole(['host', 'guest', 'spectator']).role === 'spectator',
  )
}

console.log('\n=== 3. hub-hello：0→1→2 人对齐身份 ===')
{
  // 房主 her 先到，客人 me 后到
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
    who: 'her', // 客人进房前可能误选 her
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

console.log('\n=== 8. 场景串联：常驻房三人入座 ===')
{
  // 模拟：A 空房进 → host her；B 进 → guest 自动 me；C 进 → spectator
  const roles = []
  const a = pickRelayRole(roles).role
  roles.push(a)
  const b = pickRelayRole(roles).role
  roles.push(b)
  const c = pickRelayRole(roles).role
  roles.push(c)
  assert('A=host B=guest C=spectator', eq([a, b, c], ['host', 'guest', 'spectator']))

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
  // 互发 hello
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
  // 清掉 parked 后才能跟
  const d2 = decideHubPick({
    isSpectator: false,
    entering: false,
    parkedGame: null,
  })
  assert('无 parked 可跟进', d2.action === 'follow')
}

console.log(`\n—— 结果：${passed} 通过，${failed} 失败 ——\n`)
process.exit(failed ? 1 : 0)
