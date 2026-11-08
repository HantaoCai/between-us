import { useEffect, useRef } from 'react'
import { games } from './games'
import type { GuessResult } from './guessGame'
import type { NoteAbout } from './notes'
import type { Card } from './poker'

/** hub = 已开房、尚未选定具体游戏 */
export type PeerGameId = 'hub' | PeerPlayGameId

export const PEER_PLAY_GAMES = [
  'guess',
  'quiz',
  'draw',
  'selfdraw',
  'poker',
  'dice',
  'reaction',
  'flip',
  'gomoku',
  'chemistry',
] as const
export type PeerPlayGameId = (typeof PEER_PLAY_GAMES)[number]

export function isPeerPlayGame(id: string): id is PeerPlayGameId {
  return (PEER_PLAY_GAMES as readonly string[]).includes(id)
}

export type SavedPokerStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

export type SavedPokerPublic = {
  street: SavedPokerStreet
  board: Card[]
  pot: number
  stacks: Record<NoteAbout, number>
  toAct: NoteAbout
  betThisRound: Record<NoteAbout, number>
  /** 这手每人已投入；旧存档可缺省，运行时会推断 */
  committed?: Record<NoteAbout, number>
  /** 本街谁已行动；旧存档可缺省，运行时会推断 */
  actedThisStreet?: Record<NoteAbout, boolean>
  /** 本街谁已加注；旧存档可缺省，运行时会推断 */
  raisedThisStreet?: Record<NoteAbout, boolean>
  raisesThisStreet: number
  folded: NoteAbout | null
  button: NoteAbout
  result?: string
  /** 有一方筹码耗尽，整局结束 */
  matchOver?: boolean
  /** 谁已主动/强制亮出底牌；旧存档可缺省 */
  revealed?: Record<NoteAbout, boolean>
  /** 谁已点「下一手」；双方都准备后才发牌 */
  readyNext?: Record<NoteAbout, boolean>
}

/** 切出去再进来时接着这一手，而不是重新发牌 */
export type SavedPokerHand = {
  handId: number
  seq: number
  public: SavedPokerPublic
  holes: Record<NoteAbout, Card[]>
  deck: Card[]
}

/** 猜数字：刷新后接着同一局的出题与猜测进度 */
export type SavedGuessRound = {
  digits: 4 | 5 | 6
  secret: string
  secretLocked: boolean
  peerReady: boolean
  myGuesses: GuessResult[]
  peerGuesses: GuessResult[]
  iSolved: boolean
  peerSolved: boolean
  peerTurns: number | null
  /** 终局后收到的对方答案；对局中不存 */
  peerSecret?: string | null
  endReason?: 'match' | 'resign' | null
  resignedBy?: NoteAbout | null
}

/** 五子棋：回大厅 / 刷新后接着同一盘（含终局） */
export type SavedGomokuStone = 'black' | 'white'

export type SavedGomoku = {
  seq: number
  cells: Array<SavedGomokuStone | null>
  turn: NoteAbout
  black: NoteAbout
  forbidden: boolean
  winner: NoteAbout | null
  endReason: 'five' | 'resign' | null
  last: number | null
  moves: number[]
  firstBlack: NoteAbout
}

/** peer = 双人房；solo = 人机（本地 Bot，无 WebRTC） */
export type RoomMode = 'peer' | 'solo'

export type SavedPeerRoom = {
  game: PeerGameId
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
  savedAt: number
  mode?: RoomMode
  /** 开房时是否允许旁观；默认 false */
  allowSpectators?: boolean
  /** 自己回大厅时记下刚才那局，大厅可点「继续游戏」回去 */
  parkedGame?: PeerPlayGameId | null
  /** @deprecated 新存档用 guess；读旧档时仍兼容 */
  digits?: 4 | 5 | 6
  /** @deprecated 新存档用 guess */
  secret?: string
  /** @deprecated 新存档用 guess */
  secretLocked?: boolean
  guess?: SavedGuessRound | null
  poker?: SavedPokerHand | null
  gomoku?: SavedGomoku | null
}

const KEY = 'between-us:peer-room'
const COOKIE = 'bu_peer_room'
/**
 * 本机对局存档保留 24 小时（德州/猜数字等进度）。
 * 云端房间是另一套：有人在最多 24h，人走光立刻解散；同号再进可凭本机存档续玩。
 */
export const PEER_ROOM_TTL_MS = 24 * 60 * 60 * 1000
const TTL_MS = PEER_ROOM_TTL_MS
const TTL_SEC = Math.floor(TTL_MS / 1000)

export function peerGameTitle(game: PeerGameId): string {
  if (game === 'hub') return '游戏房间'
  return games.find((g) => g.id === game)?.title ?? game
}

export function peerGamePath(game: PeerGameId): string {
  if (game === 'hub') return '/games'
  return games.find((g) => g.id === game)?.path ?? `/games/${game}`
}

const POKER_STREETS = new Set<SavedPokerStreet>([
  'preflop',
  'flop',
  'turn',
  'river',
  'showdown',
])

function isAbout(value: unknown): value is NoteAbout {
  return value === 'her' || value === 'me'
}

function isCard(value: unknown): value is Card {
  if (!value || typeof value !== 'object') return false
  const card = value as Card
  return (
    typeof card.rank === 'string' &&
    card.rank.length > 0 &&
    typeof card.suit === 'string' &&
    card.suit.length > 0
  )
}

function isCardList(value: unknown): value is Card[] {
  return Array.isArray(value) && value.every(isCard)
}

export function isSavedPokerHand(value: unknown): value is SavedPokerHand {
  if (!value || typeof value !== 'object') return false
  const hand = value as SavedPokerHand
  const pub = hand.public
  if (typeof hand.handId !== 'number' || typeof hand.seq !== 'number') return false
  if (!pub || typeof pub !== 'object') return false
  if (!POKER_STREETS.has(pub.street)) return false
  if (!isCardList(pub.board)) return false
  if (typeof pub.pot !== 'number') return false
  if (!pub.stacks || typeof pub.stacks.her !== 'number' || typeof pub.stacks.me !== 'number') {
    return false
  }
  if (!isAbout(pub.toAct) || !isAbout(pub.button)) return false
  if (pub.folded != null && !isAbout(pub.folded)) return false
  if (
    !pub.betThisRound ||
    typeof pub.betThisRound.her !== 'number' ||
    typeof pub.betThisRound.me !== 'number'
  ) {
    return false
  }
  if (typeof pub.raisesThisStreet !== 'number') return false
  if (!hand.holes || !isCardList(hand.holes.her) || !isCardList(hand.holes.me)) return false
  return isCardList(hand.deck)
}

function isGuessResult(value: unknown): value is GuessResult {
  if (!value || typeof value !== 'object') return false
  const g = value as Partial<GuessResult>
  if (
    typeof g.guess !== 'string' ||
    typeof g.hits !== 'number' ||
    typeof g.at !== 'number'
  ) {
    return false
  }
  return g.pending === undefined || typeof g.pending === 'boolean'
}

export function isSavedGuessRound(value: unknown): value is SavedGuessRound {
  if (!value || typeof value !== 'object') return false
  const round = value as SavedGuessRound
  if (round.digits !== 4 && round.digits !== 5 && round.digits !== 6) {
    return false
  }
  if (typeof round.secret !== 'string') return false
  if (typeof round.secretLocked !== 'boolean') return false
  if (typeof round.peerReady !== 'boolean') return false
  if (!Array.isArray(round.myGuesses) || !round.myGuesses.every(isGuessResult)) {
    return false
  }
  if (!Array.isArray(round.peerGuesses) || !round.peerGuesses.every(isGuessResult)) {
    return false
  }
  if (typeof round.iSolved !== 'boolean' || typeof round.peerSolved !== 'boolean') {
    return false
  }
  if (
    round.peerSecret != null &&
    typeof round.peerSecret !== 'string'
  ) {
    return false
  }
  if (
    round.endReason != null &&
    round.endReason !== 'match' &&
    round.endReason !== 'resign'
  ) {
    return false
  }
  if (
    round.resignedBy != null &&
    round.resignedBy !== 'her' &&
    round.resignedBy !== 'me'
  ) {
    return false
  }
  return round.peerTurns === null || typeof round.peerTurns === 'number'
}

const GOMOKU_CELLS = 15 * 15

function isGomokuStone(value: unknown): value is SavedGomokuStone | null {
  return value === null || value === 'black' || value === 'white'
}

export function isSavedGomoku(value: unknown): value is SavedGomoku {
  if (!value || typeof value !== 'object') return false
  const g = value as SavedGomoku
  if (!Number.isInteger(g.seq) || g.seq < 1) return false
  if (!Array.isArray(g.cells) || g.cells.length !== GOMOKU_CELLS) return false
  if (!g.cells.every(isGomokuStone)) return false
  if (!isAbout(g.turn) || !isAbout(g.black) || !isAbout(g.firstBlack)) return false
  if (typeof g.forbidden !== 'boolean') return false
  if (g.winner != null && !isAbout(g.winner)) return false
  if (g.endReason != null && g.endReason !== 'five' && g.endReason !== 'resign') {
    return false
  }
  if (g.last != null && (!Number.isInteger(g.last) || g.last < 0 || g.last >= GOMOKU_CELLS)) {
    return false
  }
  if (!Array.isArray(g.moves)) return false
  return g.moves.every(
    (i) => Number.isInteger(i) && i >= 0 && i < GOMOKU_CELLS,
  )
}

/**
 * 同房号跨页保留对局 payload：回大厅 / 切到别的游戏时沿用
 *（德州→猜数字→再进德州还能续前一把）；显式传 null 清空；换房号丢掉。
 */
function keepPayload<T>(
  explicit: T | null | undefined,
  prev: T | undefined,
  keep: boolean,
): T | undefined {
  if (explicit !== undefined) return explicit ?? undefined
  return keep ? prev : undefined
}

function isValidRoom(parsed: unknown): parsed is SavedPeerRoom {
  if (!parsed || typeof parsed !== 'object') return false
  const p = parsed as SavedPeerRoom
  const codeOk =
    typeof p.code === 'string' &&
    (/^\d{6}$/.test(p.code) || /^solo\d{2}$/i.test(p.code))
  const modeOk = p.mode == null || p.mode === 'peer' || p.mode === 'solo'
  return (
    codeOk &&
    modeOk &&
    (p.role === 'host' || p.role === 'joiner') &&
    (p.game === 'hub' ||
      (typeof p.game === 'string' && isPeerPlayGame(p.game))) &&
    typeof p.savedAt === 'number'
  )
}

function writeCookie(value: string | null) {
  try {
    if (value == null) {
      document.cookie = `${COOKIE}=;path=/;max-age=0;SameSite=Lax`
      return
    }
    document.cookie = `${COOKIE}=${encodeURIComponent(value)};path=/;max-age=${TTL_SEC};SameSite=Lax`
  } catch {
    /* ignore */
  }
}

function readCookie(): string | null {
  try {
    const match = document.cookie
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE}=`))
    if (!match) return null
    return decodeURIComponent(match.slice(COOKIE.length + 1))
  } catch {
    return null
  }
}

function storeRoom(next: SavedPeerRoom) {
  const raw = JSON.stringify(next)
  try {
    localStorage.setItem(KEY, raw)
  } catch {
    /* ignore quota / private mode */
  }
  // 整手牌 / 猜数字 / 棋盘放进 cookie 可能超长，超了就只留房间号，完整态仍以 localStorage 为准
  if (encodeURIComponent(raw).length < 3800) {
    writeCookie(raw)
    return
  }
  const slim: SavedPeerRoom = { ...next }
  delete slim.poker
  delete slim.guess
  delete slim.gomoku
  writeCookie(JSON.stringify(slim))
}

export type PeerRoomMetaInput = {
  game: PeerGameId
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
  mode?: RoomMode
  allowSpectators?: boolean
  parkedGame?: PeerPlayGameId | null
}

/** 对局内容字段；未传则由 savePeerRoom 按同房号规则保留/丢弃 */
export type PeerRoomPayload = {
  poker?: SavedPokerHand | null
  guess?: SavedGuessRound | null
  gomoku?: SavedGomoku | null
}

/** 各游戏页组房间元信息；对局内容走 poker/guess/gomoku */
export function peerRoomMeta(
  opts: PeerRoomMetaInput,
): Omit<SavedPeerRoom, 'savedAt'> {
  const next: Omit<SavedPeerRoom, 'savedAt'> = {
    game: opts.game,
    code: opts.code,
    role: opts.role,
    who: opts.who,
  }
  if (opts.mode) next.mode = opts.mode
  if (opts.allowSpectators !== undefined) {
    next.allowSpectators = !!opts.allowSpectators
  }
  if (opts.parkedGame !== undefined) next.parkedGame = opts.parkedGame
  return next
}

/** 写房间档：元信息共用，各游戏只附自己的 payload */
export function savePlayPeerRoom(
  meta: PeerRoomMetaInput,
  payload?: PeerRoomPayload,
): void {
  savePeerRoom({
    ...peerRoomMeta(meta),
    ...payload,
  })
}

export function savePeerRoom(
  room: Omit<SavedPeerRoom, 'savedAt'> & { savedAt?: number },
): void {
  const prev = readPeerRoom()
  const sameCode = !!prev && prev.code === room.code
  const poker = keepPayload(room.poker, prev?.poker, sameCode)
  const guess = keepPayload(room.guess, prev?.guess, sameCode)
  const gomoku = keepPayload(room.gomoku, prev?.gomoku, sameCode)
  const mode = keepPayload(
    room.mode,
    prev?.mode,
    sameCode,
  )
  const next: SavedPeerRoom = {
    ...room,
    savedAt: room.savedAt ?? Date.now(),
  }
  if (mode) next.mode = mode
  else delete next.mode
  if (poker) next.poker = poker
  else delete next.poker
  if (guess) next.guess = guess
  else delete next.guess
  if (gomoku) next.gomoku = gomoku
  else delete next.gomoku
  const allowSpec =
    room.allowSpectators !== undefined
      ? !!room.allowSpectators
      : sameCode
        ? prev?.allowSpectators
        : undefined
  if (allowSpec !== undefined) next.allowSpectators = !!allowSpec
  else delete next.allowSpectators
  // 进具体游戏清掉；在大厅则显式传入或沿用上一档
  if (room.game !== 'hub') {
    delete next.parkedGame
  } else {
    const parked =
      room.parkedGame !== undefined
        ? room.parkedGame || undefined
        : prev?.parkedGame || undefined
    if (parked && isPeerPlayGame(parked)) next.parkedGame = parked
    else delete next.parkedGame
  }
  storeRoom(next)
}

export function readPeerRoom(): SavedPeerRoom | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    raw = null
  }
  if (!raw) raw = readCookie()
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isValidRoom(parsed)) {
      clearPeerRoom()
      return null
    }
    if (Date.now() - parsed.savedAt > TTL_MS) {
      clearPeerRoom()
      return null
    }
    // 两边对齐，避免微信只清了其中一侧
    storeRoom(parsed)
    return parsed
  } catch {
    return null
  }
}

export function clearPeerRoom(game?: PeerGameId): void {
  try {
    if (game) {
      const cur = readPeerRoom()
      if (cur && cur.game !== game) return
    }
    localStorage.removeItem(KEY)
    writeCookie(null)
  } catch {
    writeCookie(null)
  }
}

export function patchPeerRoom(patch: Partial<SavedPeerRoom>): void {
  const cur = readPeerRoom()
  if (!cur) return
  savePeerRoom({ ...cur, ...patch, savedAt: Date.now() })
}

/** 离开页面前再写一次，减少微信直接杀 WebView 时丢存档 */
export function useFlushPeerRoomOnLeave(
  enabled: boolean,
  build: () => Omit<SavedPeerRoom, 'savedAt'> | null,
) {
  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    if (!enabled) return
    const flush = () => {
      const room = buildRef.current()
      if (room) savePeerRoom(room)
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [enabled])
}
