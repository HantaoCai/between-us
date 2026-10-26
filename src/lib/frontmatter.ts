export type FrontmatterResult = {
  data: Record<string, unknown>
  content: string
}

function parseScalar(raw: string): unknown {
  const value = raw.trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((part) => {
      const item = part.trim()
      if (
        (item.startsWith('"') && item.endsWith('"')) ||
        (item.startsWith("'") && item.endsWith("'"))
      ) {
        return item.slice(1, -1)
      }
      return item
    })
  }
  return value
}

export function parseFrontmatter(raw: string): FrontmatterResult {
  const normalized = raw.replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---')) {
    return { data: {}, content: normalized.trim() }
  }

  const end = normalized.indexOf('\n---', 3)
  if (end === -1) {
    return { data: {}, content: normalized.trim() }
  }

  const block = normalized.slice(3, end).trim()
  const content = normalized.slice(end + 4).replace(/^\r?\n/, '')
  const data: Record<string, unknown> = {}

  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon === -1) continue
    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1)
    data[key] = parseScalar(value)
  }

  return { data, content: content.trim() }
}
