import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PeerConnDebug } from '../components/PeerConnDebug'
import { PeerLobby, RoomBanner } from '../components/PeerLobby'
import { RoomInvite } from '../components/RoomInvite'
import { assetUrl } from '../lib/assetUrl'
import { roomGames } from '../lib/games'
import { aboutLabel, otherAbout, type NoteAbout } from '../lib/notes'
import { peerLog } from '../lib/peerLog'
import {
  claimOrJoinPeerRoom,
  createPeerRoom,
  joinPeerRoom,
  type RoomSession,
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
  const [phase, setPhase] = useState<Phase>('lobby')
  /** 我自己的身份；先到开房时选定，后到由房主 hello 分配 */
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [code, setCode] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const sessionRef = useRef<RoomSession | null>(null)
  const whoRef = useRef(who)
  const isHostRef = useRef(false)
  const codeRef = useRef('')
  const enteringRef = useRef(false)
  const bootRef = useRef(false)
  const joinAbortRef = useRef(0)
  const aliveRef = useRef(true)
  whoRef.current = who
  isHostRef.current = isHost
  codeRef.current = code

  const urlRoom = readRoomParam(params.get('room'))

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      joinAbortRef.current += 1
      if (enteringRef.current) return
      // 延迟销毁：避开 StrictMode 卸载→立刻重挂把刚建好的房拆掉
      const snapshot = sessionRef.current
      window.setTimeout(() => {
        if (aliveRef.current || enteringRef.current) return
        if (sessionRef.current !== snapshot) return
        peerLog('页面卸载，销毁会话')
        snapshot?.destroy()
        if (sessionRef.current === snapshot) sessionRef.current = null
      }, 150)
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

    // 从对局里带房间回来：按原身份重进，不要抢房主
    if (params.get('resume') !== '1') return
    const saved = readPeerRoom()
    if (!saved || saved.game !== 'hub') return
    whoRef.current = saved.who
    setWho(saved.who)
    setCode(saved.code)
    codeRef.current = saved.code
    setIsHost(saved.role === 'host')
    isHostRef.current = saved.role === 'host'
    setPhase('room')
    setBusy(true)
    writeRoomParam(saved.code)
    if (saved.role === 'host') void createAsHost(saved.code)
    else void joinAsGuest(saved.code)
  }, [params])

  function writeRoomParam(room: string) {
    const next = new URLSearchParams()
    next.set('room', room)
    setParams(next, { replace: true })
  }

  function persistHub() {
    const room = codeRef.current
    if (!room) return
    savePeerRoom({
      game: 'hub',
      code: room,
      role: isHostRef.current ? 'host' : 'joiner',
      who: whoRef.current,
    })
  }

  function hello() {
    sessionRef.current?.sendReliable({
      type: 'hub-hello',
      who: whoRef.current,
    } satisfies HubMsg)
  }

  function onData(raw: unknown) {
    if (!isHubMsg(raw)) return
    if (raw.type === 'hub-hello') {
      setError('')
      if (isHostRef.current) {
        // 房主身份为准，对方固定是另一边
        const peer = otherAbout(whoRef.current)
        setPeerWho(peer)
      } else {
        const hostWho = raw.who
        const mine = otherAbout(hostWho)
        setPeerWho(hostWho)
        if (whoRef.current !== mine) {
          whoRef.current = mine
          setWho(mine)
        }
        persistHub()
        hello()
      }
      return
    }
    if (raw.type === 'hub-pick') {
      void enterGame(raw.game, false)
    }
  }

  function onRoomOpen() {
    setError('')
    hello()
  }

  async function createAsHost(existingCode: string) {
    const token = ++joinAbortRef.current
    setBusy(true)
    setError('')
    setPeerWho(null)
    setIsHost(true)
    isHostRef.current = true
    setCode(existingCode)
    codeRef.current = existingCode
    setPhase('room')
    try {
      sessionRef.current?.destroy()
      const session = await createPeerRoom(
        {
          onData,
          onOpen: onRoomOpen,
          onWake: () => hello(),
          onDisconnect: () => {
            setPeerWho(null)
            setError('对方断开了，仍可留在房间等他回来')
          },
          onClose: () => {
            setPeerWho(null)
            setError('连接断了')
          },
        },
        { code: existingCode },
      )
      if (token !== joinAbortRef.current || !aliveRef.current) {
        session.destroy()
        return
      }
      sessionRef.current = session
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

  async function joinAsGuest(room: string) {
    const token = ++joinAbortRef.current
    setBusy(true)
    setError('')
    setPeerWho(null)
    setCode(room)
    codeRef.current = room
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
        sessionRef.current?.destroy()
        sessionRef.current = null
        const session = await joinPeerRoom(
          room,
          {
            onData,
            onOpen: onRoomOpen,
            onWake: () => hello(),
            onDisconnect: () => {
              setPeerWho(null)
              setError('对方断开了，正在重连…')
            },
            onClose: () => {
              setPeerWho(null)
              setError('连接断了')
            },
          },
          { timeoutMs: 10000 },
        )
        if (token !== joinAbortRef.current || !aliveRef.current) {
          session.destroy()
          return
        }
        sessionRef.current = session
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
        try {
          sessionRef.current?.destroy()
        } catch {
          /* ignore */
        }
        sessionRef.current = null
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
  async function enterShared(room: string) {
    const token = ++joinAbortRef.current
    setBusy(true)
    setError('')
    setPeerWho(null)
    setCode(room)
    codeRef.current = room
    setPhase('room')
    writeRoomParam(room)

    try {
      sessionRef.current?.destroy()
      sessionRef.current = null
      peerLog('大厅进房', room)
      const session = await claimOrJoinPeerRoom(
        room,
        {
          onData,
          onOpen: onRoomOpen,
          onWake: () => hello(),
          onDisconnect: () => {
            setPeerWho(null)
            setError('对方断开了，仍可留在房间等他回来')
          },
          onClose: () => {
            setPeerWho(null)
            setError('连接断了')
          },
        },
        { joinTimeoutMs: 10000 },
      )
      if (token !== joinAbortRef.current || !aliveRef.current) {
        session.destroy()
        return
      }
      sessionRef.current = session
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
    const room = urlRoom || codeRef.current || newRoomCode()
    void enterShared(room)
  }

  async function enterGame(game: PeerPlayGameId, announce: boolean) {
    if (enteringRef.current || picking) return
    const session = sessionRef.current
    if (!session) return

    if (!isHostRef.current && peerWho) {
      const mine = otherAbout(peerWho)
      whoRef.current = mine
      setWho(mine)
    }

    setPicking(true)
    enteringRef.current = true
    try {
      if (announce) {
        session.sendReliable({ type: 'hub-pick', game } satisfies HubMsg)
        await sleep(220)
      }
      savePeerRoom({
        game,
        code: session.code,
        role: session.isHost ? 'host' : 'joiner',
        who: whoRef.current,
      })
      session.destroy()
      sessionRef.current = null
      await sleep(announce ? 700 : 1400)
      navigate(`${peerGamePath(game)}?resume=1`)
    } catch (e) {
      enteringRef.current = false
      setPicking(false)
      setError(e instanceof Error ? e.message : '进入游戏失败')
    }
  }

  function leaveRoom() {
    joinAbortRef.current += 1
    enteringRef.current = false
    bootRef.current = true
    sessionRef.current?.destroy()
    sessionRef.current = null
    clearPeerRoom()
    setPeerWho(null)
    setError('')
    setPicking(false)
    setBusy(false)
    // 保留链接里的房间号，方便同一扫码链接再进
    if (codeRef.current) writeRoomParam(codeRef.current)
    setPhase('lobby')
  }

  function retryEnter() {
    if (busy || !codeRef.current) return
    // 重试也用先到开房 / 后到加入，避免卡在错误身份
    void enterShared(codeRef.current)
  }

  function pickGame(game: PeerPlayGameId) {
    if (busy || picking || !isHostRef.current) return
    if (!peerWho) {
      setError('等对方进房后再选游戏')
      return
    }
    if (peerWho === whoRef.current) {
      setError('身份还没同步好，稍等再选')
      return
    }
    void enterGame(game, true)
  }

  const reconnecting = busy && phase === 'room' && !peerWho

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
            {picking
              ? '正在进入…'
              : reconnecting
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
                style={{ ['--tilt' as string]: i % 2 === 0 ? '-1.2deg' : '1.4deg' }}
              >
                <button
                  type="button"
                  className="game-tile-link w-full text-left"
                  disabled={
                    busy ||
                    picking ||
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
              disabled={busy || picking}
              onClick={leaveRoom}
            >
              离开房间
            </button>
          </div>

          <PeerConnDebug />
        </div>
      )}
    </section>
  )
}
