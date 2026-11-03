/** 旁观：跟进对局、禁操作、上帝视角（线上升对战端仍靠 UI 遮私密） */

export function isSpectatorSession(flag: boolean | null | undefined): boolean {
  return !!flag
}

export function spectatorWatchLabel(gameTitle: string): string {
  return `旁观${gameTitle}`
}

export function spectatorWatchHint(): string {
  return '上帝视角 · 只看不玩'
}
