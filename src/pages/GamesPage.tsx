import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PeerConnDebug } from '../components/PeerConnDebug'
import { PeerLobby, RoomBanner } from '../components/PeerLobby'
import { RoomInvite } from '../components/RoomInvite'
import { assetUrl } from '../lib/assetUrl'
import { roomGames } from '../lib/games'
import { aboutLabel, otherAbout, type NoteAbout } from '../lib/notes'
import { takeHubRecall } from '../lib/hubNav'
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
    return {
      game: 'hub',
      code,
      role: isHost ? 'host' : 'joiner',
      who: whoRef.current,
    }
  })

  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true

    const handlers = hubHandlers()

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
      persistHub()
      if (room.session.conn?.open) handlers.onOpen()
      return
    }

    const saved = readPeerRoom()
    if (!saved) return

    const resume = params.get('resume') === '1'
    if (saved.game !== 'hub' && !resume) return

    void (async () => {
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
    })()
  }, [params])

  function writeRoomParam(roomCode: string) {
    const next = new URLSearchParams()
    next.set('room', roomCode)
    setParams(next, { replace: true })
  }

  function persistHub() {
    const roomCode = codeRef.current
    if (!roomCode) return
    savePeerRoom({
      game: 'hub',
      code: roomCode,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
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
        setError(
          isHostRef.current
            ? '连接不稳，正在重连…'
            : '连接不稳，正在重连…',
        )
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
      // 仅在对方点了「再来一局」类协议时拉回。
      // 进新游戏途中的 hello/setup/mine 也会打到大厅，不能一概 hub-return，否则永远进不去。
      if (
        !enteringRef.current &&
        phaseRef.current === 'room' &&
        peerWhoRef.current &&
        sessionHoldRef.current?.conn?.open &&
        raw &&
        typeof raw === 'object' &&
        'type' in raw
      ) {
        const t = (raw as { type: string }).type
        if (t === 'again' || t === 'start' || t === 'secret-ready') {
          peerLog('大厅：对方还在再来一局，拉回', t)
          room.sendReliable({ type: 'hub-return' }, 4)
        }
      }
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
      setError(e instanceof Error ? e.message : '开房失败')
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
      lastErr instanceof Error
        ? `${lastErr.message}。点下方重试，或等对方先打开链接`
        : '加入失败。点下方重试，或等对方先打开链接',
    )
    setPhase('room')
    setBusy(false)
  }

  /** 同一链接：先到开房（用当前 who），后到加入并变成另一身份 */
  async function enterShared(roomCode: string) {
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
      setError(e instanceof Error ? e.message : '进房失败')
      setPhase('room')
    } finally {
      if (token === joinAbortRef.current) setBusy(false)
    }
  }

  function enterFromLobby() {
    const roomCode = urlRoom || codeRef.current || newRoomCode()
    void enterShared(roomCode)
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
      savePeerRoom({
        game,
        code: session.code,
        role: session.isHost ? 'host' : 'joiner',
        who: whoRef.current,
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
    clearPeerRoom()
    setPeerWho(null)
    setError('')
    setPicking(false)
    setBusy(false)
    if (codeRef.current) writeRoomParam(codeRef.current)
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
      setError('等对方进房后再选游戏')
      return
    }
    if (peerWhoRef.current === whoRef.current) {
      setError('身份还没同步好，稍等再选')
      return
    }
    void enterGame(game, true)
  }

  const reconnecting = busy && phase === 'room' && !peerWho

  // 换页后对方可能错过 hello，对上之前持续补发
  useEffect(() => {
    if (phase !== 'room' || busy || peerWho) return
    hello()
    const id = window.setInterval(() => {
      if (!room.session?.conn?.open) return
      hello()
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase, busy, peerWho])

  // 自己刚点「回大厅」：短时补喊 hub-return；对方已出现在大厅或开始选游戏就停
  useEffect(() => {
    if (phase !== 'room' || !code) return
    if (!takeHubRecall(code)) return
    peerLog('大厅：补喊对方回房', code)
    let n = 0
    const shout = () => {
      if (enteringRef.current || pickingRef.current) return false
      if (peerWhoRef.current) return false
      if (!sessionHoldRef.current?.conn?.open) return true
      room.sendReliable({ type: 'hub-return' }, 4)
      hello()
      return true
    }
    if (!shout()) return
    const id = window.setInterval(() => {
      if (!shout() || ++n >= 8) window.clearInterval(id)
    }, 200)
    return () => window.clearInterval(id)
  }, [phase, code])

  return (
    <section className="game-shell mx-auto w-full max-w-lg px-4 pb-16 pt-1 sm:px-6">
      <h1 className="sr-only">小游戏</h1>

      {phase === 'lobby' ? (
        <div className="rise-in space-y-8">
          <div>
            <p className="text-xs tracking-[0.2em] text-[var(--ink-soft)]">对战</p>
            <p className="mt-2 font-display text-2xl text-[var(--ink)] sm:text-3xl">
              同一个链接，进同一间房
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              先到的人选身份并开房，后到的人打开同一链接自动变成另一边。
            </p>
          </div>

          <PeerLobby
            busy={busy}
            error={error}
            who={who}
            onWho={setWho}
            onEnter={enterFromLobby}
            enterLabel={urlRoom ? '进房间' : '生成房间链接'}
            roomHint={
              urlRoom ? `当前链接房间 ${urlRoom}` : undefined
            }
          />
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
                code={code}
                detail={
                  peerWho
                    ? `你是${aboutLabel(who)} · 对方${aboutLabel(peerWho)}`
                    : isHost
                      ? `你是${aboutLabel(who)} · 等对方打开同一链接`
                      : reconnecting
                        ? '正在进房…'
                        : '已进房，同步身份中…'
                }
              />

              {isHost && !peerWho && code ? (
                <RoomInvite code={code} disabled={busy} />
              ) : null}

              <p className="text-sm text-[var(--ink-soft)]">
                {reconnecting
                  ? isHost
                    ? '正在恢复房间…'
                    : '正在进房，请稍等…'
                  : !peerWho
                    ? isHost
                      ? '对方扫码，或点「发给对方」'
                      : '已进房，等先到的人确认身份…'
                    : isHost
                      ? '选一个游戏，对方会自动跟着进'
                      : '等先到的人选游戏，选好后会自动进入'}
              </p>

              <ul className="game-grid mt-1">
                {roomGames.map((game, i) => (
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
                        !isPeerPlayGame(game.id)
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
                        <span className="game-tile-tag">{game.tag}</span>
                      </div>
                      <h2 className="game-tile-title">{game.title}</h2>
                    </button>
                  </li>
                ))}
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
