import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PeerConnDebug } from '../components/PeerConnDebug'
import { PeerLobby, RoomBanner } from '../components/PeerLobby'
import { assetUrl } from '../lib/assetUrl'
import {
  createBotRoomSession,
  isSoloRoomCode,
  SOLO_ROOM_CODE,
} from '../lib/botRoomSession'
import { roomGames } from '../lib/games'
import { createGomokuBotDriver } from '../lib/gomokuBot'
import {
  canHostPickGame,
  decideHubPick,
  enterLabelForPeers,
  hubRoomDetail,
  hubRoomStatusLine,
  hubRoomView,
  resolveHubHello,
  seatModeForPeers,
} from '../lib/hubRoom'
import { otherAbout, type NoteAbout } from '../lib/notes'
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
  peerRoomMeta,
  readPeerRoom,
  savePlayPeerRoom,
  useFlushPeerRoomOnLeave,
  type PeerPlayGameId,
} from '../lib/peerRoomSave'
import {
  ensureCoupleRoomCode,
  saveCoupleRoomCode,
} from '../lib/coupleRoom'
import { subscribeOnlineRooms, type OnlineRoom } from '../lib/peerRoomsApi'
import { readRoomParam } from '../lib/roomLink'

type Phase = 'lobby' | 'room'

type HubMsg =
  | { type: 'hub-hello'; who: NoteAbout; seat?: 'player' | 'spectator' }
  | { type: 'hub-pick'; game: PeerPlayGameId }

function isHubMsg(raw: unknown): raw is HubMsg {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) return false
  const msg = raw as HubMsg
  if (msg.type === 'hub-hello') {
    if (msg.who !== 'her' && msg.who !== 'me') return false
    if (msg.seat != null && msg.seat !== 'player' && msg.seat !== 'spectator') {
      return false
    }
    return true
  }
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
  const [isSpectator, setIsSpectator] = useState(room.isSpectator)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  /** boot（恢复本机房间）结束后才订阅在线列表 */
  const [bootReady, setBootReady] = useState(false)
  const [onlineRooms, setOnlineRooms] = useState<OnlineRoom[]>([])
  /** 自己从对局回大厅后，可点中间「继续游戏」回去 */
  const [parkedGame, setParkedGame] = useState<PeerPlayGameId | null>(() => {
    const g = readPeerRoom()?.parkedGame
    return g && isPeerPlayGame(g) ? g : null
  })
  const whoRef = useRef(who)
  const isHostRef = useRef(false)
  const isSpectatorRef = useRef(false)
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
  const urlRoom = readRoomParam(params.get('room'))
  const urlRoomRef = useRef(urlRoom)
  const standingCode = ensureCoupleRoomCode()
  whoRef.current = who
  isHostRef.current = isHost
  isSpectatorRef.current = isSpectator
  codeRef.current = code
  peerWhoRef.current = peerWho
  phaseRef.current = phase
  pickingRef.current = picking
  sessionHoldRef.current = room.session
  urlRoomRef.current = urlRoom

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
    return peerRoomMeta({
      game: 'hub',
      code,
      role: isHost ? 'host' : 'joiner',
      who: whoRef.current,
      mode: solo ? 'solo' : 'peer',
    })
  })

  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true

    const handlers = hubHandlers()
    const finishBoot = () => setBootReady(true)
    const linkRoom = readRoomParam(params.get('room'))

    // 已在 Provider 里握着连接（刚从游戏页返回）——只换回大厅回调
    // URL 房号与会话不符、或 Peer 已毁：清掉，停在大厅让用户点进
    if (room.session) {
      const live = room.session
      const dead = live.peer.destroyed
      const mismatch = !!linkRoom && live.code !== linkRoom
      if (dead || mismatch) {
        peerLog('大厅 boot：丢弃失效/不符会话', {
          dead,
          mismatch,
          code: live.code,
          linkRoom,
        })
        room.destroySession()
        sessionHoldRef.current = null
        clearPeerHandoff()
        if (mismatch) clearPeerRoom()
      } else {
        whoRef.current = room.who
        setWho(room.who)
        setCode(room.code)
        codeRef.current = room.code
        setIsHost(room.isHost)
        isHostRef.current = room.isHost
        setIsSpectator(!!room.isSpectator)
        isSpectatorRef.current = !!room.isSpectator
        room.setSpectator(!!room.isSpectator)
        setPeerWho(room.peerWho)
        peerWhoRef.current = room.peerWho
        sessionHoldRef.current = live
        setPhase('room')
        writeRoomParam(room.code)
        room.bindHandlers(handlers)
        setBusy(false)
        setError('')
        persistHub(isSoloRoomCode(room.code) ? 'solo' : 'peer')
        if (live.conn?.open) handlers.onOpen()
        finishBoot()
        return
      }
    }

    const saved = readPeerRoom()
    // 链接房号优先：旧存档与 URL 不一致时不恢复
    if (linkRoom && saved && saved.code !== linkRoom) {
      clearPeerRoom()
      clearPeerHandoff()
      finishBoot()
      return
    }

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
          if (live.peer.destroyed) {
            peerLog('大厅 boot：暂存已毁', saved.code)
            clearPeerHandoff()
            return
          }
          // 异步回来时链接房号已变：不要把旧房写进 URL
          const latestLink = urlRoomRef.current
          if (latestLink && live.code !== latestLink) {
            peerLog('大厅 boot：暂存与链接不符，释放', {
              parked: live.code,
              latestLink,
            })
            clearPeerHandoff()
            return
          }
          whoRef.current = saved.who
          setWho(saved.who)
          room.setWho(saved.who)
          setCode(saved.code)
          codeRef.current = saved.code
          setIsHost(saved.role === 'host')
          isHostRef.current = saved.role === 'host'
          applySpectator(!!live.isSpectator)
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
        // 有陈旧 hub 存档但无 resume：停在大厅，等用户点进
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

  // 链接里的房号只用来记住常驻房，不再自动钻进（去掉扫码自动进房）
  useEffect(() => {
    if (!urlRoom) return
    saveCoupleRoomCode(urlRoom)
  }, [urlRoom])

  // 大厅订阅在线房：进出由 Worker 推送，不轮询
  useEffect(() => {
    if (!bootReady || phase !== 'lobby') return
    return subscribeOnlineRooms(setOnlineRooms)
  }, [bootReady, phase])

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
    savePlayPeerRoom({
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
      seat: isSpectatorRef.current ? 'spectator' : 'player',
    } satisfies HubMsg)
  }

  function applySpectator(next: boolean) {
    isSpectatorRef.current = next
    setIsSpectator(next)
    room.setSpectator(next)
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
      return
    }
    if (enteringRef.current) return
    if (raw.type === 'hub-hello') {
      setError('')
      const result = resolveHubHello(
        {
          who: whoRef.current,
          peerWho: peerWhoRef.current,
          isHost: isHostRef.current,
          isSpectator: isSpectatorRef.current,
        },
        raw,
      )
      if (result.ignore) {
        if (result.replyHello) hello()
        return
      }
      if (result.peerWho !== peerWhoRef.current) {
        peerWhoRef.current = result.peerWho
        setPeerWho(result.peerWho)
        room.setPeerWho(result.peerWho)
      }
      if (result.who !== whoRef.current) {
        whoRef.current = result.who
        setWho(result.who)
        room.setWho(result.who)
        persistHub()
      }
      if (result.replyHello) hello()
      return
    }
    if (raw.type === 'hub-pick') {
      const parkedRaw = readPeerRoom()?.parkedGame
      const parked =
        parkedRaw && isPeerPlayGame(parkedRaw) ? parkedRaw : null
      const decision = decideHubPick({
        isSpectator: isSpectatorRef.current,
        entering: enteringRef.current,
        parkedGame: parked,
      })
      if (decision.action === 'ignore') {
        if (decision.reason === 'parked' && parked) setParkedGame(parked)
        peerLog(`大厅：忽略 hub-pick（${decision.reason}）`, raw.game)
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
    applySpectator(false)
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
      applySpectator(!!session.isSpectator)
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
    applySpectator(false)
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
        applySpectator(!!session.isSpectator)
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

  /** 进指定房：先到开房，后到加入并对侧；第三人旁观 */
  async function enterShared(
    roomCode: string,
    opts?: { preferJoin?: boolean },
  ) {
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
      sessionHoldRef.current = null
      peerLog('大厅进房', roomCode)
      const session = await claimOrJoinPeerRoom(roomCode, hubHandlers(), {
        joinTimeoutMs: 12000,
        preferJoin: opts?.preferJoin,
      })
      if (token !== joinAbortRef.current || !aliveRef.current) {
        try {
          session.destroy()
        } catch {
          /* ignore */
        }
        return
      }
      peerLog('大厅进房成功', {
        code: session.code,
        isHost: session.isHost,
        spectator: !!session.isSpectator,
        open: !!session.conn?.open,
      })
      saveCoupleRoomCode(session.code)
      room.attachSession(session, { who: whoRef.current })
      sessionHoldRef.current = session
      room.bindHandlers(hubHandlers())
      setIsHost(session.isHost)
      isHostRef.current = session.isHost
      applySpectator(!!session.isSpectator)
      setCode(session.code)
      codeRef.current = session.code
      writeRoomParam(session.code)
      setPhase('room')
      setError('')
      persistHub()
      if (!session.isHost || session.isSpectator) hello()
    } catch (e) {
      if (token !== joinAbortRef.current) return
      peerLog('大厅进房失败', e)
      setError(friendlyPeerError(e, '进房失败'))
      setPhase('lobby')
      clearRoomParam()
    } finally {
      if (token === joinAbortRef.current) setBusy(false)
    }
  }

  function chooseWho(next: NoteAbout) {
    whoRef.current = next
    setWho(next)
    room.setWho(next)
  }

  /** 进入指定房（列表点选 / 常驻房 / 重试） */
  function enterRoomFromLobby(roomCode: string) {
    if (busy || enteringRef.current) return
    if (isSoloRoomCode(codeRef.current)) {
      setCode('')
      codeRef.current = ''
    }
    room.setWho(whoRef.current)
    const next = roomCode.replace(/\D/g, '').slice(0, 6)
    if (next.length !== 6) {
      setError('房间号不对')
      return
    }
    saveCoupleRoomCode(next)
    setError('')
    writeRoomParam(next)
    void enterShared(next, { preferJoin: true })
  }

  /** 进入常驻房 */
  function enterCoupleFromLobby() {
    enterRoomFromLobby(urlRoom || standingCode)
  }

  function standingPeers(): number {
    const hit = onlineRooms.find((r) => r.code === standingCode)
    return hit?.peers ?? 0
  }

  /** 开房后加人机：拆掉 WebRTC，挂本地 Bot，再回选游戏 */
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
      applySpectator(false)
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
    applySpectator(false)
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
    if (isSpectatorRef.current) {
      peerLog('大厅：旁观不能进对局', game)
      setError('旁观不能开局，等他们打完')
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
      savePlayPeerRoom({
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
    clearPeerHandoff()
    room.destroySession()
    sessionHoldRef.current = null
    clearPeerRoom()
    setPeerWho(null)
    room.setPeerWho(null)
    setParkedGame(null)
    setError('')
    setPicking(false)
    setBusy(false)
    setCode('')
    codeRef.current = ''
    setIsHost(false)
    isHostRef.current = false
    applySpectator(false)
    // 回大厅看在线列表，需再点进入
    clearRoomParam()
    setPhase('lobby')
  }
  function retryEnter() {
    if (busy || !codeRef.current) return
    // 客人重试先加入；房主重试仍先抢号
    void enterShared(codeRef.current, {
      preferJoin: !isHostRef.current,
    })
  }

  function pickGame(game: PeerPlayGameId) {
    const live = sessionHoldRef.current ?? room.session
    const gate = canHostPickGame({
      isHost: isHostRef.current,
      isSpectator: isSpectatorRef.current,
      busy,
      picking: picking || pickingRef.current,
      entering: enteringRef.current,
      who: whoRef.current,
      peerWho: peerWhoRef.current,
      connOpen: !!live?.conn?.open,
      solo: isSoloHub(),
      game,
    })
    if (!gate.ok) {
      setError(gate.reason)
      return
    }
    // 人机无需广播；真人房才 notify 对方
    void enterGame(game, !isSoloHub())
  }

  const reconnecting = busy && phase === 'room' && !peerWho
  const soloHub = isSoloHub() || isSoloRoomCode(code)
  const view = hubRoomView({
    isSpectator,
    isHost,
    peerWho,
    solo: soloHub,
    reconnecting,
  })
  const showGameGrid =
    !isSpectator && (view === 'host-ready' || view === 'solo-ready')

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
          <div>
            <p className="text-xs tracking-[0.2em] text-[var(--ink-soft)]">对战</p>
            <p className="mt-2 font-display text-2xl text-[var(--ink)] sm:text-3xl">
              {error ? '进房不太顺' : '在线房间'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              {error
                ? '可重试，或从下面列表另选一间。'
                : '常驻房一直在。没人时先选角色；已有一人自动对侧；满两人再进只能旁观。'}
            </p>
          </div>

          <PeerLobby
            busy={busy}
            error={error || undefined}
            who={who}
            onWho={chooseWho}
            onEnter={enterCoupleFromLobby}
            enterLabel={enterLabelForPeers(standingPeers())}
            busyLabel="进房中…"
            seatMode={seatModeForPeers(standingPeers())}
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs tracking-[0.2em] text-[var(--ink-soft)]">
                当前在线
              </p>
            </div>
            {(() => {
              const standing = onlineRooms.find((r) => r.code === standingCode)
              const others = onlineRooms.filter((r) => r.code !== standingCode)
              const rows: OnlineRoom[] = [
                {
                  code: standingCode,
                  peers: standing?.peers ?? 0,
                  at: standing?.at ?? 0,
                },
                ...others,
              ]
              return (
                <ul className="space-y-2">
                  {rows.map((r) => {
                    const mine = r.code === standingCode
                    const playersFull = r.peers >= 2
                    return (
                      <li key={r.code}>
                        <button
                          type="button"
                          className="game-lobby-ghost flex w-full items-center justify-between gap-3 text-left"
                          disabled={busy}
                          onClick={() => enterRoomFromLobby(r.code)}
                        >
                          <span>
                            房间 {r.code}
                            {mine ? ' · 常驻' : ''}
                          </span>
                          <span className="text-xs text-[var(--ink-soft)]">
                            {r.peers <= 0
                              ? '空房'
                              : playersFull
                                ? `${r.peers} 人 · 可旁观`
                                : `${r.peers} 人在线`}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )
            })()}
          </div>
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
                detail={hubRoomDetail({
                  view,
                  who,
                  peerWho,
                  solo: soloHub,
                })}
              />

              <p className="text-sm text-[var(--ink-soft)]">
                {hubRoomStatusLine({ view, isHost, solo: soloHub })}
              </p>

              {view === 'wait-peer' ? (
                <button
                  type="button"
                  className="game-lobby-ghost"
                  disabled={busy}
                  onClick={addAiBot}
                >
                  添加 AI 机器人
                </button>
              ) : null}

              {parkedGame && !picking && !isSpectator ? (
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

              {showGameGrid ? (
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
                          ['--tilt' as string]:
                            i % 2 === 0 ? '-1.2deg' : '1.4deg',
                        }}
                      >
                        <button
                          type="button"
                          className="game-tile-link w-full text-left"
                          disabled={busy || !playable}
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
              ) : null}

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
