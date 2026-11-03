import type { Memory, MemoryKind, SiteMeta, StickyNote } from './types'
import seedNotes from '../data/notes.json'
import seedMemories from '../data/memories.json'
import seedSite from '../data/site.json'
import { fetchWallNotes, fetchMemoriesCloud } from './cloudApi'
import { normalizeNotes } from './wall'

export function getSite(): SiteMeta {
  return seedSite as SiteMeta
}

export function daysTogether(since = getSite().togetherSince): number {
  const start = new Date(`${since}T00:00:00`)
  const now = new Date()
  const diff = now.getTime() - start.getTime()
  return Math.max(0, Math.floor(diff / 86400000) + 1)
}

export async function loadNotes(): Promise<StickyNote[]> {
  const cloud = await fetchWallNotes()
  if (cloud && cloud.length > 0) return normalizeNotes(cloud)
  return normalizeNotes(seedNotes as StickyNote[])
}

export async function loadMemories(): Promise<Memory[]> {
  const cloud = await fetchMemoriesCloud()
  if (cloud && cloud.length > 0) return cloud
  return (seedMemories as Memory[]).slice()
}

export function filterMemories(list: Memory[], kind: MemoryKind) {
  return list.filter((m) => m.kind === kind)
}

export function kindLabel(kind: MemoryKind): string {
  switch (kind) {
    case 'milestone':
      return '里程碑'
    case 'place':
      return '地方'
    case 'impression':
      return '印象'
    default:
      return '归档'
  }
}
