import { useEffect, useRef } from 'react'
import { games } from './games'
import type { NoteAbout } from './notes'
import type { Card } from './poker'

/** hub = 已开房、尚未选定具体游戏 */
export type PeerGameId = 'hub' | PeerPlayGameId

export const PEER_PLAY_GAMES = [
  'guess',
  'quiz',
  'draw',
  'poker',
  'dice',
  'reaction',
  'flip',
  'gomoku',
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
  /** 本街谁已行动；旧存档可缺省，运行时会推断 */
  actedThisStreet?: Record<NoteAbout, boolean>
  raisesThisStreet: number
  folded: NoteAbout | null
  button: NoteAbout
  result?: string
  /** 有一方筹码耗尽，整局结束 */
  matchOver?: boolean
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
  digits: 4 | 5
  secret: string
  secretLocked: boolean
  peerReady: boolean
  myGuesses: Array<{ guess: string; hits: number; at: number }>
  peerGuesses: Array<{ guess: string; hits: number; at: number }>
  iSolved: boolean
  peerSolved: boolean
  peerTurns: number | null
}

export type SavedPeerRoom = {
  game: PeerGameId
  code: string
  role: 'host' | 'joiner'
  who: NoteAbout
  savedAt: number
  /** @deprecated 新存档用 guess；读旧档时仍兼容 */
  digits?: 4 | 5
  /** @deprecated 新存档用 guess */
  secret?: string
  /** @deprecated 新存档用 guess */
  secretLocked?: boolean
  guess?: SavedGuessRound | null
  poker?: SavedPokerHand | null
}

const KEY = 'between-us:peer-room'
const COOKIE = 'bu_peer_room'
const TTL_MS = 6 * 60 * 60 * 1000
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

function isGuessResult(value: unknown): value is SavedGuessRound['myGuesses'][number] {
  if (!value || typeof value !== 'object') return false
  const g = value as SavedGuessRound['myGuesses'][number]
  return (
    typeof g.guess === 'string' &&
    typeof g.hits === 'number' &&
    typeof g.at === 'number'
  )
}

export function isSavedGuessRound(value: unknown): value is SavedGuessRound {
  if (!value || typeof value !== 'object') return false
  const round = value as SavedGuessRound
  if (round.digits !== 4 && round.digits !== 5) return false
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
  return round.peerTurns === null || typeof round.peerTurns === 'number'
}

function isValidRoom(parsed: unknown): parsed is SavedPeerRoom {
  if (!parsed || typeof parsed !== 'object') return false
  const p = parsed as SavedPeerRoom
  return (
    typeof p.code === 'string' &&
    /^\d{6}$/.test(p.code) &&
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
  // 整手牌 / 猜数字进度放进 cookie 可能超长，超了就只留房间号，完整态仍以 localStorage 为准
  if (encodeURIComponent(raw).length < 3800) {
    writeCookie(raw)
    return
  }
  const slim: SavedPeerRoom = { ...next }
  delete slim.poker
  delete slim.guess
  writeCookie(JSON.stringify(slim))
}

export function savePeerRoom(
  room: Omit<SavedPeerRoom, 'savedAt'> & { savedAt?: number },
): void {
  const prev = readPeerRoom()
  const sameTable = !!prev && prev.game === room.game && prev.code === room.code
  const poker =
    room.poker !== undefined ? (room.poker ?? undefined) : sameTable ? prev?.poker : undefined
  const guess =
    room.guess !== undefined ? (room.guess ?? undefined) : sameTable ? prev?.guess : undefined
  const next: SavedPeerRoom = {
    ...room,
    savedAt: room.savedAt ?? Date.now(),
  }
  if (poker) next.poker = poker
  else delete next.poker
  if (guess) next.guess = guess
  else delete next.guess
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
