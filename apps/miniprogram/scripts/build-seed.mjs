import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../../..')
const out = path.resolve(__dirname, '../src/data')

const dir = path.join(root, 'memories')
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { data: {}, content: raw }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return { data: {}, content: raw }
  const fm = raw.slice(3, end).trim()
  const content = raw.slice(end + 4).replace(/^\n/, '')
  const data = {}
  for (const line of fm.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v
        .slice(1, -1)
        .split(/[,，]/)
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else {
      v = v.replace(/^["']|["']$/g, '')
    }
    data[m[1]] = v
  }
  return { data, content: content.trim() }
}

const memories = files
  .map((f) => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8')
    const slug = f.replace(/\.md$/, '')
    const { data, content } = parseFrontmatter(raw)
    const tags = Array.isArray(data.tags)
      ? data.tags
      : typeof data.tags === 'string'
        ? data.tags
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    return {
      slug,
      title: String(data.title || slug),
      date: String(data.date || '1970-01-01'),
      place: String(data.place || ''),
      mood: String(data.mood || ''),
      tags,
      cover: String(data.cover || ''),
      kind: ['event', 'impression', 'milestone', 'place'].includes(data.kind)
        ? data.kind
        : 'event',
      body: content,
    }
  })
  .sort((a, b) => b.date.localeCompare(a.date))

fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'memories.json'), JSON.stringify(memories, null, 2))
fs.copyFileSync(path.join(root, 'src/data/notes.json'), path.join(out, 'notes.json'))
fs.copyFileSync(path.join(root, 'src/data/site.json'), path.join(out, 'site.json'))
console.log('seed ok', { memories: memories.length })
