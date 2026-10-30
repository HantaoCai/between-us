import site from '../data/site.json'
import { parseFrontmatter } from './frontmatter'

export type MemoryKind = 'event' | 'impression' | 'milestone' | 'place'

export type Memory = {
  slug: string
  title: string
  date: string
  place: string
  mood: string
  tags: string[]
  cover: string
  kind: MemoryKind
  body: string
}

const KIND_SET = new Set<MemoryKind>(['event', 'impression', 'milestone', 'place'])

const rawModules = import.meta.glob('../../memories/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function toSlug(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.md$/, '')
}

function parseKind(raw: unknown): MemoryKind {
  const value = String(raw ?? 'event') as MemoryKind
  return KIND_SET.has(value) ? value : 'event'
}

function parseMemory(path: string, raw: string): Memory | null {
  const slug = toSlug(path)
  if (slug.startsWith('_') || slug.toLowerCase() === 'readme') {
    return null
  }

  const { data, content } = parseFrontmatter(raw)
  const tags = Array.isArray(data.tags)
    ? data.tags.map(String)
    : typeof data.tags === 'string'
      ? data.tags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : []

  return {
    slug,
    title: String(data.title ?? slug),
    date: String(data.date ?? '1970-01-01'),
    place: String(data.place ?? ''),
    mood: String(data.mood ?? ''),
    tags,
    cover: String(data.cover ?? ''),
    kind: parseKind(data.kind),
    body: content.trim(),
  }
}

export const memories: Memory[] = Object.entries(rawModules)
  .map(([path, raw]) => parseMemory(path, raw))
  .filter((m): m is Memory => m !== null)
  .sort((a, b) => b.date.localeCompare(a.date))

/** 琐碎日常，降级为归档 */
export const archiveMemories = memories.filter((m) => m.kind === 'event')
/** @deprecated 使用 archiveMemories */
export const timelineMemories = archiveMemories

export const impressionMemories = memories.filter((m) => m.kind === 'impression')
export const milestoneMemories = memories.filter((m) => m.kind === 'milestone')
export const placeMemories = memories.filter((m) => m.kind === 'place')

export function getMemory(slug: string): Memory | undefined {
  return memories.find((m) => m.slug === slug)
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

/** 相识起点：可在网页编辑，或改 src/data/site.json */
export const TOGETHER_SINCE = site.togetherSince
export const TOGETHER_LABEL = site.togetherLabel
