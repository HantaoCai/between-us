import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PeerConnDebug } from '../components/PeerConnDebug'
import { PeerLobby, RoomBanner } from '../components/PeerLobby'
import { RoomInvite } from '../components/RoomInvite'
import { assetUrl } from '../lib/assetUrl'
import {
  createBotRoomSession,
  isSoloRoomCode,
  SOLO_ROOM_CODE,
} from '../lib/botRoomSession'
import { roomGames } from '../lib/games'
import { createGomokuBotDriver } from '../lib/gomokuBot'
import { aboutLabel, otherAbout, type NoteAbout } from '../lib/notes'
import { friendlyPeerError } from '../lib/peerConfig'
import { peerLog } from '../lib/peerLog'
import { usePeerRoom } from '../lib/PeerRoomContext'
import {
  adoptParkedSession,
  clearPeerHandoff,
} from '../lib/peerHandoff'
import {
  claimOrJoinPeerRoom,
  createPeerRoom,
  joinPeerRoom,
} from '../lib/peerRoom'
import {
  clearPeerRoom,
  isPeerPlayGame,
  peerGamePath,
  peerGameTitle,
  readPeerRoom,
  savePeerRoom,
  useFlushPeerRoomOnLeave,
  type PeerPlayGameId,
} from '../lib/peerRoomSave'
import { newRoomCode, readRoomParam } from '../lib/roomLink'

type Phase = 'lobby' | 'room'

type HubMsg =
  | { type: 'hub-hello'; who: NoteAbout }
  | { type: 'hub-pick'; game: PeerPlayGameId }

function isHubMsg(raw: unknown): raw is HubMsg {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) return false
  const msg = raw as HubMsg
  if (msg.type === 'hub-hello') return msg.who === 'her' || msg.who === 'me'
  if (msg.type === 'hub-pick') return isPeerPlayGame(msg.game)
  return false
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function GamesPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const room = usePeerRoom()
  const [phase, setPhase] = useState<Phase>('lobby')
  /** 我自己的身份；先到开房时选定，后到由房主 hello 分配 */
  const [who, setWho] = useState<NoteAbout>(room.who)
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(room.peerWho)
  const [code, setCode] = useState(room.code)
  const [isHost, setIsHost] = useState(room.isHost)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  /** boot（恢复本机房间）结束后才允许扫码自动进房 */
  const [bootReady, setBootReady] = useState(false)
  /** 自己从对局回大厅后，可点中间「继续游戏」回去 */
  const [parkedGame, setParkedGame] = useState<PeerPlayGameId | null>(() => {
    const g = readPeerRoom()?.parkedGame
    return g && isPeerPlayGame(g) ? g : null
  })
  const whoRef = useRef(who)
  const isHostRef = useRef(false)
  const codeRef = useRef('')
  const peerWhoRef = useRef<NoteAbout | null>(room.peerWho)
  const phaseRef = useRef<Phase>(phase)
  const pickingRef = useRef(false)
  /** handlers 在 attach 前就绑过，enterGame 必须读最新 session，不能闭包旧的 room.session */
  const sessionHoldRef = useRef(room.session)
  const enteringRef = useRef(false)
  const bootRef = useRef(false)
  const joinAbortRef = useRef(0)
  const aliveRef = useRef(true)
  /** 带房间号的链接只自动进一次，避免离开后再被立刻拉回去 */
  const autoJoinKeyRef = useRef<string | null>(null)
  whoRef.current = who
  isHostRef.current = isHost
  codeRef.current = code
  peerWhoRef.current = peerWho
  phaseRef.current = phase
  pickingRef.current = picking
  sessionHoldRef.current = room.session

  const urlRoom = readRoomParam(params.get('room'))

  useEffect(() => {
    aliveRef.current = true
    // 从对局页返回会重新挂载：清掉上一轮进游戏残留，否则点其它游戏会直接 return
    enteringRef.current = false
    pickingRef.current = false
    setPicking(false)
    return () => {
      aliveRef.current = false
      joinAbortRef.current += 1
      // Peer 由 PeerRoomProvider 持有，大厅卸载不再 park/destroy
    }
  }, [])

  useFlushPeerRoomOnLeave(phase === 'room' && !!code, () => {
    if (!code) return null
    const solo = isSoloRoomCode(code)
    return {
      game: 'hub',
      code,
      role: isHost ? 'host' : 'joiner',
      who: whoRef.current,
      mode: solo ? 'solo' : 'peer',
    }
  })

  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true

    const handlers = hubHandlers()
    const finishBoot = () => setBootReady(true)

    // 已在 Provider 里握着连接（刚从游戏页返回）——只换回大厅回调
    if (room.session) {
      whoRef.current = room.who
      setWho(room.who)
      setCode(room.code)
      codeRef.current = room.code
      setIsHost(room.isHost)
      isHostRef.current = room.isHost
      setPeerWho(room.peerWho)
      peerWhoRef.current = room.peerWho
      sessionHoldRef.current = room.session
      setPhase('room')
      writeRoomParam(room.code)
      room.bindHandlers(handlers)
      setBusy(false)
      setError('')
      persistHub(isSoloRoomCode(room.code) ? 'solo' : 'peer')
      if (room.session.conn?.open) handlers.onOpen()
      finishBoot()
      return
    }

    const saved = readPeerRoom()
    if (!saved) {
      finishBoot()
      return
    }

    const resume = params.get('resume') === '1'
    if (saved.game !== 'hub' && !resume) {
      finishBoot()
      return
    }

    // 人机房：本地重建 Bot，不走 PeerJS
    if (saved.mode === 'solo' || isSoloRoomCode(saved.code)) {
      attachSoloBot(saved.who)
      setBusy(false)
      setError('')
      finishBoot()
      return
    }

    void (async () => {
      try {
        const live = await adoptParkedSession(
          saved.code,
          saved.role === 'host',
          handlers,
        )
        if (live) {
          whoRef.current = saved.who
          setWho(saved.who)
          room.setWho(saved.who)
          setCode(saved.code)
          codeRef.current = saved.code
          setIsHost(saved.role === 'host')
          isHostRef.current = saved.role === 'host'
          setPhase('room')
          writeRoomParam(saved.code)
          room.attachSession(live, { who: saved.who })
          sessionHoldRef.current = live
          room.bindHandlers(handlers)
          setBusy(false)
          setError('')
          persistHub()
          if (live.conn?.open) handlers.onOpen()
          return
        }

        if (!resume && saved.game !== 'hub') return
        // 有陈旧 hub 存档但无 resume：不在这里死等，交给下面扫码自动进房
        if (!resume) return

        whoRef.current = saved.who
        setWho(saved.who)
        setCode(saved.code)
        codeRef.current = saved.code
        setIsHost(saved.role === 'host')
        isHostRef.current = saved.role === 'host'
        setPhase('room')
        writeRoomParam(saved.code)
        setBusy(true)
        if (saved.role === 'host') void createAsHost(saved.code)
        else void joinAsGuest(saved.code)
      } finally {
        finishBoot()
      }
    })()
  }, [params])

  // 扫码 / 打开带房间号的链接：跳过选身份页，直接进房；身份由房主 hello 分配
  useEffect(() => {
    if (!bootReady) return
    if (!urlRoom) return
    if (phase !== 'lobby') return
    if (room.session || sessionHoldRef.current) return
    if (autoJoinKeyRef.current === urlRoom) return
    // 对局页 resume 交给 boot
    if (params.get('resume') === '1') return

    autoJoinKeyRef.current = urlRoom
    const saved = readPeerRoom()
    // 链接房号优先；清掉过期本机存档，避免身份/角色串台
    if (saved && saved.code !== urlRoom) clearPeerRoom()
    void enterShared(urlRoom)
  }, [bootReady, urlRoom, phase, params, room.session])

  function writeRoomParam(roomCode: string) {
    const next = new URLSearchParams()
    next.set('room', roomCode)
    setParams(next, { replace: true })
  }

  function clearRoomParam() {
    setParams(new URLSearchParams(), { replace: true })
  }

  function isSoloHub() {
    return isSoloRoomCode(codeRef.current)
  }

  function persistHub(mode?: 'peer' | 'solo') {
    const roomCode = codeRef.current
    if (!roomCode) return
    const solo = mode === 'solo' || isSoloRoomCode(roomCode)
    savePeerRoom({
      game: 'hub',
      code: roomCode,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
      mode: solo ? 'solo' : 'peer',
    })
  }

  function hello() {
    room.sendReliable({
      type: 'hub-hello',
      who: whoRef.current,
    } satisfies HubMsg)
  }

  function hubHandlers(): {
    onData: (raw: unknown) => void
    onOpen: () => void
    onWake: () => void
    onDisconnect: () => void
    onClose: () => void
  } {
    return {
      onData,
      onOpen: onRoomOpen,
      onWake: () => {
        if (enteringRef.current) return
        hello()
      },
      onDisconnect: () => {
        // 选游戏进房时双方会主动拆连接，别当成掉线去闪二维码
        if (enteringRef.current) return
        // 短暂 ICE 抖动不拆 peerWho，避免大厅又闪成「等对方」
        setError('对方暂时断线了，正在等他回来…')
      },
      onClose: () => {
        if (enteringRef.current) return
        setPeerWho(null)
        room.setPeerWho(null)
        setError('连接断了')
      },
    }
  }

  function onData(raw: unknown) {
    if (!isHubMsg(raw)) {
      // 对方还在对局里点「再来一局」时，大厅不再强拉；可点「继续游戏」自己回去
      // 进房只认 hub-pick
      return
    }
    if (enteringRef.current) return
    if (raw.type === 'hub-hello') {
      setError('')
      if (isHostRef.current) {
        // 房主身份为准，对方固定是另一边
        const peer = otherAbout(whoRef.current)
        const firstSight = peerWhoRef.current !== peer
        setPeerWho(peer)
        peerWhoRef.current = peer
        room.setPeerWho(peer)
        // 对方后到时补一发，避免他错过我们更早的 hello
        if (firstSight) hello()
      } else {
        const hostWho = raw.who
        const mine = otherAbout(hostWho)
        setPeerWho(hostWho)
        peerWhoRef.current = hostWho
        room.setPeerWho(hostWho)
        if (whoRef.current !== mine) {
          whoRef.current = mine
          setWho(mine)
          room.setWho(mine)
        }
        persistHub()
        hello()
      }
      return
    }
    if (raw.type === 'hub-pick') {
      // 自己刚点回大厅留下的 parkedGame：忽略自动拉回，等点「继续游戏」
      const parked = readPeerRoom()?.parkedGame
      if (parked && isPeerPlayGame(parked)) {
        peerLog('大厅：忽略 hub-pick（已回大厅）', raw.game)
        setParkedGame(parked)
        return
      }
      peerLog('大厅：收到 hub-pick', raw.game)
      void enterGame(raw.game, false)
    }
  }

  function onRoomOpen() {
    if (enteringRef.current) return
    setError('')
    hello()
  }

  async function createAsHost(existingCode: string) {
    const token = ++joinAbortRef.current
    setBusy(true)
    setError('')
    setPeerWho(null)
    room.setPeerWho(null)
    setIsHost(true)
    isHostRef.current = true
    setCode(existingCode)
    codeRef.current = existingCode
    setPhase('room')
    try {
      room.destroySession()
      const session = await createPeerRoom(hubHandlers(), { code: existingCode })
      if (token !== joinAbortRef.current || !aliveRef.current) {
        session.destroy()
        return
      }
      room.attachSession(session, { who: whoRef.current })
      sessionHoldRef.current = session
      room.bindHandlers(hubHandlers())
      setIsHost(true)
      isHostRef.current = true
      setCode(session.code)
      codeRef.current = session.code
      writeRoomParam(session.code)
      setPhase('room')
      setError('')
      persistHub()
    } catch (e) {
      if (token !== joinAbortRef.current) return
      setError(friendlyPeerError(e, '开房失败'))
      setPhase('room')
    } finally {
      if (token === joinAbortRef.current) setBusy(false)
    }
  }

  async function joinAsGuest(roomCode: string) {
    const token = ++joinAbortRef.current
    setBusy(true)
    setError('')
    setPeerWho(null)
    room.setPeerWho(null)
    setCode(roomCode)
    codeRef.current = roomCode
    setIsHost(false)
    isHostRef.current = false
    setPhase('room')

    const retries = 8
    let lastErr: unknown

    for (let attempt = 0; attempt < retries; attempt++) {
      if (token !== joinAbortRef.current) return
      if (attempt > 0) {
        setError(`正在重新进房（${attempt + 1}/${retries}）…`)
        await sleep(600 * attempt)
        if (token !== joinAbortRef.current) return
      } else {
        setError('正在进房…')
      }

      try {
        room.destroySession()
        const session = await joinPeerRoom(roomCode, hubHandlers(), {
          timeoutMs: 10000,
        })
        if (token !== joinAbortRef.current || !aliveRef.current) {
          session.destroy()
          return
        }
        room.attachSession(session, { who: whoRef.current })
        sessionHoldRef.current = session
        room.bindHandlers(hubHandlers())
        setIsHost(false)
        isHostRef.current = false
        setCode(session.code)
        codeRef.current = session.code
        writeRoomParam(session.code)
        setPhase('room')
        setError('')
        persistHub()
        hello()
        setBusy(false)
        return
      } catch (e) {
        lastErr = e
        room.destroySession()
      }
    }

    if (token !== joinAbortRef.current) return
    setError(
      `${friendlyPeerError(lastErr, '加入失败')}。点下方重试，或等对方先打开链接`,
    )
    setPhase('room')
    setBusy(false)
  }

  /** 同一链接：先到开房（用当前 who），后到加入并变成另一身份 */
  async function enterShared(roomCode: string) {
    if (isSoloRoomCode(roomCode)) {
      setError('人机不能通过链接加入，请开房后添加机器人')
      return
    }
    const token = ++joinAbortRef.current
    setBusy(true)
    setError('')
    setPeerWho(null)
    room.setPeerWho(null)
    setCode(roomCode)
    codeRef.current = roomCode
    setPhase('room')
    writeRoomParam(roomCode)

    try {
      room.destroySession()
      peerLog('大厅进房', roomCode)
      const session = await claimOrJoinPeerRoom(roomCode, hubHandlers(), {
        joinTimeoutMs: 10000,
      })
      if (token !== joinAbortRef.current || !aliveRef.current) {
        session.destroy()
        return
      }
      room.attachSession(session, { who: whoRef.current })
      sessionHoldRef.current = session
      room.bindHandlers(hubHandlers())
      setIsHost(session.isHost)
      isHostRef.current = session.isHost
      setCode(session.code)
      codeRef.current = session.code
      writeRoomParam(session.code)
      setPhase('room')
      setError('')
      persistHub()
      if (!session.isHost) hello()
    } catch (e) {
      if (token !== joinAbortRef.current) return
      setError(friendlyPeerError(e, '进房失败'))
      setPhase('room')
    } finally {
      if (token === joinAbortRef.current) setBusy(false)
    }
  }

  function chooseWho(next: NoteAbout) {
    whoRef.current = next
    setWho(next)
    room.setWho(next)
  }

  /** 开房大厅：用当前身份创建新房间（带房间号的链接不会走到这里） */
  function createFromLobby() {
    // 人机房号不能当分享链接；残留 solo 码先清掉
    if (isSoloRoomCode(codeRef.current)) {
      setCode('')
      codeRef.current = ''
      clearRoomParam()
    }
    room.setWho(whoRef.current)
    void enterShared(newRoomCode())
  }  /** 开房后加人机：拆掉 WebRTC，挂本地 Bot，再回选游戏 */
  function addAiBot() {
    if (busy || picking || enteringRef.current) return
    if (!isHostRef.current) return
    if (peerWhoRef.current) {
      setError('对方已在房里，不能再加机器人')
      return
    }
    setBusy(true)
    setError('')
    try {
      joinAbortRef.current += 1
      clearPeerHandoff()
      room.destroySession()

      const mine = whoRef.current
      const botWho = otherAbout(mine)
      const driver = createGomokuBotDriver({ botWho, playerWho: mine })
      const session = createBotRoomSession({
        code: SOLO_ROOM_CODE,
        driver,
      })
      room.attachSession(session, { who: mine })
      sessionHoldRef.current = session
      room.setWho(mine)
      room.setPeerWho(botWho)
      setPeerWho(botWho)
      peerWhoRef.current = botWho
      setIsHost(true)
      isHostRef.current = true
      setCode(SOLO_ROOM_CODE)
      codeRef.current = SOLO_ROOM_CODE
      writeRoomParam(SOLO_ROOM_CODE)
      persistHub('solo')
      peerLog('大厅：已添加 AI 机器人')
      setBusy(false)
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : '添加机器人失败')
    }
  }

  function attachSoloBot(playerWho: NoteAbout) {
    const botWho = otherAbout(playerWho)
    const driver = createGomokuBotDriver({ botWho, playerWho })
    const session = createBotRoomSession({
      code: SOLO_ROOM_CODE,
      driver,
    })
    room.attachSession(session, { who: playerWho })
    sessionHoldRef.current = session
    room.setWho(playerWho)
    room.setPeerWho(botWho)
    whoRef.current = playerWho
    setWho(playerWho)
    setPeerWho(botWho)
    peerWhoRef.current = botWho
    setIsHost(true)
    isHostRef.current = true
    setCode(SOLO_ROOM_CODE)
    codeRef.current = SOLO_ROOM_CODE
    writeRoomParam(SOLO_ROOM_CODE)
    setPhase('room')
    persistHub('solo')
  }

  async function enterGame(game: PeerPlayGameId, announce: boolean) {
    // 必须用 ref：handlers 往往在 attachSession 之前绑好，闭包里的 room.session / picking 会是旧值
    if (enteringRef.current || pickingRef.current) {
      peerLog('大厅：enterGame 忙碌中，忽略', {
        game,
        entering: enteringRef.current,
        picking: pickingRef.current,
      })
      return
    }
    const session = sessionHoldRef.current ?? room.session
    if (!session) {
      peerLog('大厅：enterGame 无会话，忽略', game)
      setError('连接还没就绪，稍等再选')
      return
    }
    sessionHoldRef.current = session

    const seenPeer = peerWhoRef.current
    if (!isHostRef.current && seenPeer) {
      const mine = otherAbout(seenPeer)
      whoRef.current = mine
      setWho(mine)
      room.setWho(mine)
    }

    // 不拆 Peer：Provider 继续持有，只跳到游戏页换回调
    enteringRef.current = true
    pickingRef.current = true
    setPicking(true)
    setError('')
    try {
      if (announce) {
        // 多发几遍：对方可能正好处在换绑窗口，丢一条就会一人进游戏一人留大厅
        const pick = { type: 'hub-pick', game } satisfies HubMsg
        peerLog('大厅：广播 hub-pick', game)
        for (let i = 0; i < 6; i++) {
          room.sendReliable(pick, 4)
          await sleep(50)
        }
      }
      room.setPeerWho(seenPeer)
      const solo = isSoloHub()
      if (solo && game !== 'gomoku') {
        throw new Error('机器人目前只能下五子棋')
      }
      savePeerRoom({
        game,
        code: session.code,
        role: session.isHost ? 'host' : 'joiner',
        who: whoRef.current,
        mode: solo ? 'solo' : 'peer',
      })
      peerLog('大厅：进入游戏', game)
      navigate(`${peerGamePath(game)}?resume=1`)
    } catch (e) {
      enteringRef.current = false
      pickingRef.current = false
      setPicking(false)
      setError(e instanceof Error ? e.message : '进入游戏失败')
    }
  }

  function leaveRoom() {
    joinAbortRef.current += 1
    enteringRef.current = false
    bootRef.current = true
    autoJoinKeyRef.current = null
    clearPeerHandoff()
    room.destroySession()
    clearPeerRoom()
    setPeerWho(null)
    room.setPeerWho(null)
    setError('')
    setPicking(false)
    setBusy(false)
    setCode('')
    codeRef.current = ''
    setIsHost(false)
    isHostRef.current = false
    // 清掉房间号，回到「选身份开房」；避免离开后被链接自动再拉进房
    clearRoomParam()
    setPhase('lobby')
  }
  function retryEnter() {
    if (busy || !codeRef.current) return
    // 重试也用先到开房 / 后到加入，避免卡在错误身份
    void enterShared(codeRef.current)
  }

  function pickGame(game: PeerPlayGameId) {
    if (!isHostRef.current) return
    if (busy) {
      setError('还在准备房间，稍等')
      return
    }
    if (picking || pickingRef.current || enteringRef.current) {
      setError('正在进入，请稍等…')
      return
    }
    if (!peerWhoRef.current) {
      setError('等对方进房或添加机器人后再选游戏')
      return
    }
    if (peerWhoRef.current === whoRef.current) {
      setError('身份还没同步好，稍等再选')
      return
    }
    // 对方曾进房但已断开时 peerWho 仍可能残留，别独自开打
    const live = sessionHoldRef.current ?? room.session
    if (!isSoloHub() && !live?.conn?.open) {
      setError('对方还没连上，稍等再选')
      return
    }
    if (isSoloHub() && game !== 'gomoku') {
      setError('机器人目前只能下五子棋')
      return
    }
    // 人机无需广播；真人房才 notify 对方
    void enterGame(game, !isSoloHub())
  }

  const reconnecting = busy && phase === 'room' && !peerWho
  const soloHub = isSoloHub() || isSoloRoomCode(code)

  // 换页后对方可能错过 hello，对上之前持续补发
  useEffect(() => {
    if (phase !== 'room' || busy || peerWho) return
    if (isSoloRoomCode(codeRef.current)) return
    hello()
    const id = window.setInterval(() => {
      if (!room.session?.conn?.open) return
      hello()
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase, busy, peerWho])

  // 从对局页返回时同步 parkedGame（继续游戏入口）
  useEffect(() => {
    if (phase !== 'room') return
    const g = readPeerRoom()?.parkedGame
    setParkedGame(g && isPeerPlayGame(g) ? g : null)
  }, [phase, code])

  return (
    <section className="game-shell mx-auto w-full max-w-lg px-4 pb-16 pt-1 sm:px-6">
      <h1 className="sr-only">小游戏</h1>

      {phase === 'lobby' ? (
        <div className="rise-in space-y-8">
          {urlRoom ? (
            <>
              <div>
                <p className="text-xs tracking-[0.2em] text-[var(--ink-soft)]">对战</p>
                <p className="mt-2 font-display text-2xl text-[var(--ink)] sm:text-3xl">
                  正在进房…
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
                  房间 {urlRoom}，身份进房后自动对齐。
                </p>
              </div>
              {error ? (
                <div className="space-y-3">
                  <p className="text-sm text-red-700">{error}</p>
                  <button
                    type="button"
                    className="game-lobby-primary"
                    disabled={busy}
                    onClick={() => {
                      autoJoinKeyRef.current = null
                      void enterShared(urlRoom)
                    }}
                  >
                    {busy ? '进房中…' : '重新进房'}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-[var(--ink-soft)]">
                  {busy ? '连接中…' : '马上就好'}
                </p>
              )}
            </>
          ) : (
            <>
              <div>
                <p className="text-xs tracking-[0.2em] text-[var(--ink-soft)]">对战</p>
                <p className="mt-2 font-display text-2xl text-[var(--ink)] sm:text-3xl">
                  同一个链接，进同一间房
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
                  先选身份开房，再发链接请人，或在房里加 AI 机器人一起玩。
                </p>
              </div>

              <PeerLobby
                busy={busy}
                error={error}
                who={who}
                onWho={chooseWho}
                onEnter={createFromLobby}
                enterLabel="创建房间"
              />
            </>
          )}
        </div>
      ) : (
        <div className="rise-in space-y-5">
          {picking ? (
            <p className="py-16 text-center text-sm text-[var(--ink-soft)]">
              正在进入…
            </p>
          ) : (
            <>
              <RoomBanner
                code={soloHub ? '人机' : code}
                detail={
                  peerWho
                    ? soloHub
                      ? `你是${aboutLabel(who)} · 机器人已加入`
                      : `你是${aboutLabel(who)} · 对方${aboutLabel(peerWho)}`
                    : isHost
                      ? `你是${aboutLabel(who)} · 等对方打开同一链接`
                      : reconnecting
                        ? '正在进房…'
                        : '已进房，同步身份中…'
                }
              />

              {isHost && !peerWho && code ? (
                <>
                  <RoomInvite code={code} disabled={busy} />
                  <button
                    type="button"
                    className="game-lobby-ghost"
                    disabled={busy}
                    onClick={addAiBot}
                  >
                    添加 AI 机器人
                  </button>
                </>
              ) : null}

              {!(isHost && !peerWho && !reconnecting) ? (
                <p className="text-sm text-[var(--ink-soft)]">
                  {reconnecting
                    ? isHost
                      ? '正在恢复房间…'
                      : '正在进房，请稍等…'
                    : !peerWho
                      ? '已进房，等先到的人确认身份…'
                      : soloHub
                        ? isHost
                          ? '机器人已就位，选五子棋开下一局'
                          : '等先到的人选游戏'
                        : isHost
                          ? '选一个游戏，对方会自动跟着进'
                          : '等待房主开始游戏'}
                </p>
              ) : null}

              {parkedGame && !picking ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <button
                    type="button"
                    className="game-lobby-primary max-w-xs"
                    disabled={busy || (!peerWho && !soloHub)}
                    onClick={() => {
                      const g = parkedGame
                      setParkedGame(null)
                      void enterGame(g, !soloHub)
                    }}
                  >
                    继续游戏
                  </button>
                  <p className="text-xs text-[var(--ink-soft)]">
                    回到{peerGameTitle(parkedGame)}
                    {!peerWho && !soloHub ? ' · 等对方在线' : ''}
                  </p>
                </div>
              ) : null}

              <ul className="game-grid mt-1">
                {roomGames.map((game, i) => {
                  const playable =
                    isPeerPlayGame(game.id) &&
                    (!soloHub || game.id === 'gomoku')
                  return (
                  <li
                    key={game.id}
                    className={`game-tile ${i % 2 === 1 ? 'is-offset' : ''}`}
                    style={{
                      ['--tilt' as string]: i % 2 === 0 ? '-1.2deg' : '1.4deg',
                    }}
                  >
                    <button
                      type="button"
                      className="game-tile-link w-full text-left"
                      disabled={
                        busy ||
                        !peerWho ||
                        peerWho === who ||
                        !isHost ||
                        !playable
                      }
                      onClick={() => {
                        if (isPeerPlayGame(game.id)) pickGame(game.id)
                      }}
                    >
                      <div className="game-tile-media">
                        <img
                          src={assetUrl(game.cover)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                        <span className="game-tile-tag">
                          {soloHub && game.id !== 'gomoku'
                            ? '仅双人'
                            : game.tag}
                        </span>
                      </div>
                      <h2 className="game-tile-title">{game.title}</h2>
                    </button>
                  </li>
                  )
                })}
              </ul>

              {error ? <p className="text-sm text-red-700">{error}</p> : null}

              <div className="flex w-full flex-col gap-3">
                {!busy && error && code ? (
                  <button
                    type="button"
                    className="game-lobby-primary"
                    onClick={retryEnter}
                  >
                    重新进房
                  </button>
                ) : null}

                <button
                  type="button"
                  className="game-lobby-ghost"
                  disabled={busy}
                  onClick={leaveRoom}
                >
                  离开房间
                </button>
              </div>

              <PeerConnDebug />
            </>
          )}
        </div>
      )}
    </section>
  )
}
