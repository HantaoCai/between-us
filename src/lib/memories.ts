import { parseFrontmatter } from './frontmatter'

export type Memory = {
  slug: string
  title: string
  date: string
  place: string
  mood: string
  tags: string[]
  cover: string
  body: string
}

const rawModules = import.meta.glob('../../memories/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function toSlug(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.md$/, '')
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
    body: content.trim(),
  }
}

export const memories: Memory[] = Object.entries(rawModules)
  .map(([path, raw]) => parseMemory(path, raw))
  .filter((m): m is Memory => m !== null)
  .sort((a, b) => b.date.localeCompare(a.date))

export function getMemory(slug: string): Memory | undefined {
  return memories.find((m) => m.slug === slug)
}

/** 在一起起点：可改成你们真正的日期 */
export const TOGETHER_SINCE = '2024-03-15'
