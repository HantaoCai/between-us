import { useCallback, useRef, type MutableRefObject } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { createBotDriverForGame } from './botDrivers'
import { isSoloPlay, isSoloRoomCode } from './botRoomSession'
import { mountSoloBotSession } from './bootSoloSession'
import { wrapGameHandlers } from './gameSession'
import { leaveGameToHub } from './hubNav'
import { otherAbout, type NoteAbout } from './notes'
import { friendlyPeerError } from './peerConfig'
import {
  adoptParkedSession,
  releaseParkedRoom,
} from './peerHandoff'
import { usePeerRoom } from './PeerRoomContext'
import {
  createPeerRoom,
  joinPeerRoom,
  type RoomHandlers,
  type RoomSession,
} from './peerRoom'
import {
  clearPeerRoom,
  savePlayPeerRoom,
  type PeerPlayGameId,
  type SavedPeerRoom,
} from './peerRoomSave'
import { isSoloCapableGame } from './soloGames'
import { useGamePeerBoot } from './useGamePeerBoot'

export type PeerGameResumeSaved = {
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
  mode?: SavedPeerRoom['mode']
}

export type PeerGameBindSource = 'create' | 'join' | 'live' | 'solo'

type PeerRoomApi = ReturnType<typeof usePeerRoom>

/**
 * 对战页共用 create / join / leave / adoptLive / bootSolo / resume。
 * 玩法只提供 makeHandlers、afterBind、onRoomOpen。
 */
export function usePeerGameSession(opts: {
  game: PeerPlayGameId
  navigate: NavigateFunction
  room: PeerRoomApi
  sessionRef: MutableRefObject<RoomSession | null>
  whoRef: MutableRefObject<NoteAbout>
  peerWhoRef: MutableRefObject<NoteAbout | null>
  isHostRef: MutableRefObject<boolean>
  codeRef: MutableRefObject<string>
  leavingHubRef: MutableRefObject<boolean>
  setWho: (who: NoteAbout) => void
  setPeerWho: (who: NoteAbout | null) => void
  setIsHost: (host: boolean) => void
  setCode: (code: string) => void
  setBusy: (busy: boolean) => void
  setError: (error: string) => void
  /** 每次绑定时取最新 onData / onWake 等 */
  makeHandlers: () => RoomHandlers
  /** 会话挂上并 save 后：设 phase / 恢复盘面（勿在这里 onRoomOpen） */
  afterBind: (info: {
    session: RoomSession
    role: 'host' | 'joiner'
    source: PeerGameBindSource
  }) => void
  onRoomOpen: () => void
  /** create/join 失败默认回大厅；可改成 reenter */
  onConnectFail?: (
    kind: 'create' | 'join',
    error: unknown,
    ctx: { code?: string },
  ) => void
  /** 无自定义 onConnectFail 时，失败后调用（通常 setPhase('lobby')） */
  onFailLobby?: () => void
  supportsSolo?: boolean
  onSameGameRepick?: (game: PeerPlayGameId) => void
  joinErrorSuffix?: string
  beforeConnect?: (kind: 'create' | 'join') => void
  /** live 进房：有 peerWho 也当已连（Guess 用） */
  liveOpenIfPeerWho?: boolean
  /** create/join 收尾时返回 true 则不关 busy（如 reenter 排队中、等盘面恢复） */
  keepBusyAfterConnect?: () => boolean
}) {
  const optsRef = useRef(opts)
  optsRef.current = opts
  const resumeSavedRef = useRef<PeerGameResumeSaved | null>(null)

  const wrapHandlers = useCallback((inner: RoomHandlers) => {
    const o = optsRef.current
    return wrapGameHandlers(inner, {
      hereGame: o.game,
      navigate: o.navigate,
      room: o.room,
      getMeta: () => ({
        code: o.codeRef.current || o.room.code,
        role: o.isHostRef.current ? 'host' : 'joiner',
        who: o.whoRef.current,
      }),
      onLocalLeave: () => {
        o.sessionRef.current = null
      },
      onSameGameRepick: o.onSameGameRepick,
    })
  }, [])

  const bindSession = useCallback(
    (
      session: RoomSession,
      role: 'host' | 'joiner',
      kickOpen: boolean,
      source: PeerGameBindSource,
    ) => {
      const o = optsRef.current
      o.sessionRef.current = session
      o.room.attachSession(session, { who: o.whoRef.current })
      o.room.bindHandlers(wrapHandlers(o.makeHandlers()))
      o.isHostRef.current = role === 'host'
      o.setIsHost(role === 'host')
      o.codeRef.current = session.code
      o.setCode(session.code)
      savePlayPeerRoom({
        game: o.game,
        code: session.code,
        role,
        who: o.whoRef.current,
        mode: isSoloPlay({ code: session.code, session }) ? 'solo' : 'peer',
      })
      o.afterBind({ session, role, source })
      if (kickOpen && session.conn?.open) o.onRoomOpen()
    },
    [wrapHandlers],
  )

  const create = useCallback(async (existingCode?: string) => {
    const o = optsRef.current
    o.setBusy(true)
    o.setError('')
    o.beforeConnect?.('create')
    try {
      const handlers = wrapHandlers(o.makeHandlers())
      if (existingCode) {
        const live = await adoptParkedSession(existingCode, true, handlers)
        if (live) {
          bindSession(live, 'host', true, 'create')
          return
        }
      }
      o.sessionRef.current?.destroy()
      o.sessionRef.current = null
      if (existingCode) await releaseParkedRoom(existingCode)
      const session = await createPeerRoom(
        handlers,
        existingCode ? { code: existingCode } : undefined,
      )
      bindSession(session, 'host', false, 'create')
    } catch (e) {
      if (o.onConnectFail) {
        o.onConnectFail('create', e, { code: existingCode })
      } else {
        o.setError(friendlyPeerError(e, '开房失败'))
        o.onFailLobby?.()
      }
    } finally {
      if (!o.keepBusyAfterConnect?.()) o.setBusy(false)
    }
  }, [bindSession, wrapHandlers])

  const join = useCallback(async (roomCode: string) => {
    const o = optsRef.current
    o.setBusy(true)
    o.setError('')
    o.beforeConnect?.('join')
    try {
      const handlers = wrapHandlers(o.makeHandlers())
      const live = await adoptParkedSession(roomCode, false, handlers)
      if (live) {
        bindSession(live, 'joiner', true, 'join')
        return
      }
      o.sessionRef.current?.destroy()
      o.sessionRef.current = null
      await releaseParkedRoom(roomCode)
      const session = await joinPeerRoom(roomCode, handlers)
      bindSession(session, 'joiner', false, 'join')
    } catch (e) {
      if (o.onConnectFail) {
        o.onConnectFail('join', e, { code: roomCode })
      } else {
        const base = friendlyPeerError(e, '加入失败')
        o.setError(o.joinErrorSuffix ? `${base}${o.joinErrorSuffix}` : base)
        o.onFailLobby?.()
      }
    } finally {
      if (!o.keepBusyAfterConnect?.()) o.setBusy(false)
    }
  }, [bindSession, wrapHandlers])

  const bootSolo = useCallback((playerWho: NoteAbout, keepCode?: string) => {
    const o = optsRef.current
    if (!o.supportsSolo || !isSoloCapableGame(o.game)) return
    o.setBusy(true)
    o.setError('')
    const driver = createBotDriverForGame(o.game, {
      botWho: otherAbout(playerWho),
      playerWho,
    })
    const { session, botWho } = mountSoloBotSession({
      room: o.room,
      driver,
      playerWho,
      code: keepCode || o.room.code || resumeSavedRef.current?.code,
      attach: false,
    })
    o.whoRef.current = playerWho
    o.setWho(playerWho)
    o.peerWhoRef.current = botWho
    o.setPeerWho(botWho)
    bindSession(session, 'host', true, 'solo')
    o.setBusy(false)
  }, [bindSession])

  const adoptLive = useCallback(() => {
    const o = optsRef.current
    const session = o.room.session
    if (!session) return
    o.leavingHubRef.current = false
    o.room.bindHandlers(wrapHandlers(o.makeHandlers()))
    o.sessionRef.current = session
    o.whoRef.current = o.room.who
    o.setWho(o.room.who)
    o.isHostRef.current = o.room.isHost
    o.setIsHost(o.room.isHost)
    o.codeRef.current = o.room.code
    o.setCode(o.room.code)
    if (o.room.peerWho) {
      o.peerWhoRef.current = o.room.peerWho
      o.setPeerWho(o.room.peerWho)
    }
    o.afterBind({
      session,
      role: o.room.isHost ? 'host' : 'joiner',
      source: 'live',
    })
    o.setBusy(false)
    o.setError('')
    const open =
      !!session.conn?.open ||
      (o.liveOpenIfPeerWho ? !!o.room.peerWho : false)
    if (open) o.onRoomOpen()
  }, [wrapHandlers])

  const createRef = useRef(create)
  const joinRef = useRef(join)
  const bootSoloRef = useRef(bootSolo)
  const adoptLiveRef = useRef(adoptLive)
  createRef.current = create
  joinRef.current = join
  bootSoloRef.current = bootSolo
  adoptLiveRef.current = adoptLive

  useGamePeerBoot(
    opts.game,
    () => {
      const o = optsRef.current
      if (
        o.supportsSolo &&
        isSoloPlay({ code: o.room.code, session: o.room.session })
      ) {
        bootSoloRef.current(o.room.who, o.room.code)
        return
      }
      adoptLiveRef.current()
    },
    (saved) => {
      resumeSavedRef.current = {
        code: saved.code,
        role: saved.role,
        who: saved.who,
        mode: saved.mode,
      }
      const o = optsRef.current
      o.setBusy(true)
      o.setError('')
      o.whoRef.current = saved.who
      o.setWho(saved.who)
      if (
        o.supportsSolo &&
        (saved.mode === 'solo' || isSoloRoomCode(saved.code))
      ) {
        bootSoloRef.current(saved.who, saved.code)
        return
      }
      if (saved.role === 'host') void createRef.current(saved.code)
      else void joinRef.current(saved.code)
    },
  )

  const retryResume = useCallback(() => {
    const saved = resumeSavedRef.current
    if (!saved) return
    const o = optsRef.current
    o.whoRef.current = saved.who
    o.setWho(saved.who)
    if (saved.role === 'host') void create(saved.code)
    else void join(saved.code)
  }, [create, join])

  const leave = useCallback(async () => {
    const o = optsRef.current
    if (o.leavingHubRef.current) return
    o.leavingHubRef.current = true
    const roomCode = o.codeRef.current || o.room.code
    if (!roomCode) {
      clearPeerRoom(o.game)
      o.navigate('/games', { replace: true })
      return
    }
    o.setBusy(true)
    o.setError('')
    await leaveGameToHub({
      sendReliable: (data, times) => o.room.sendReliable(data, times),
      code: roomCode,
      role: o.isHostRef.current ? 'host' : 'joiner',
      who: o.whoRef.current,
      navigate: o.navigate,
      fromGame: o.game,
      onLocalLeave: () => {
        o.sessionRef.current = null
        o.peerWhoRef.current = null
        o.setPeerWho(null)
      },
    })
  }, [])

  return {
    create,
    join,
    leave,
    retryResume,
    resumeSavedRef,
    adoptLive,
    bootSolo,
    bindSession,
    wrapHandlers,
  }
}
