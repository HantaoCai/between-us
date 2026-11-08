import { isPeerPlayGame, type PeerPlayGameId } from './peerRoomSave'

/** 已支持人机对战的游戏（大厅白名单） */
export const SOLO_CAPABLE_GAMES = [
  'gomoku',
  'reaction',
  'flip',
  'quiz',
  'chemistry',
  'guess',
  'poker',
] as const satisfies readonly PeerPlayGameId[]

export type SoloCapableGame = (typeof SOLO_CAPABLE_GAMES)[number]

export function isSoloCapableGame(id: string): id is SoloCapableGame {
  return (SOLO_CAPABLE_GAMES as readonly string[]).includes(id)
}

/** 人机房仍标「仅双人」的游戏 */
export function isSoloBlockedGame(id: string): boolean {
  return isPeerPlayGame(id) && !isSoloCapableGame(id)
}
