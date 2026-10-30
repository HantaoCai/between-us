import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

type MemoryFields = {
  title: string
  date: string
  place: string
  mood: string
  tags: string[]
  cover: string
  kind?: string
  body: string
}

type PhotoItem = {
  src: string
  title: string
  date?: string
  slug?: string
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req)
  return JSON.parse(raw.toString('utf8') || '{}') as T
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function quote(value: string): string {
  if (value === '') return '""'
  if (/[:#"'\n\[\]{}]/.test(value) || value.trim() !== value) {
    return JSON.stringify(value)
  }
  return value
}

function serializeMemory(fields: MemoryFields): string {
  const tags =
    fields.tags.length === 0
      ? '[]'
      : `[${fields.tags.map((t) => quote(t)).join(', ')}]`
  const kind =
    fields.kind === 'impression' ||
    fields.kind === 'milestone' ||
    fields.kind === 'place'
      ? fields.kind
      : 'event'
  return [
    '---',
    `title: ${quote(fields.title)}`,
    `date: ${fields.date}`,
    `place: ${quote(fields.place)}`,
    `mood: ${quote(fields.mood)}`,
    `tags: ${tags}`,
    `cover: ${quote(fields.cover)}`,
    `kind: ${kind}`,
    '---',
    '',
    fields.body.trim(),
    '',
  ].join('\n')
}

function safeSlug(slug: string): string | null {
  if (!slug || slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    return null
  }
  if (slug.startsWith('_') || slug.toLowerCase() === 'readme') return null
  return slug
}

function memoryPath(root: string, slug: string) {
  return path.join(root, 'memories', `${slug}.md`)
}

function photoFileFromSrc(root: string, src: string): string | null {
  const normalized = src.replace(/^\.\//, '').replace(/^\//, '')
  if (!normalized.startsWith('photos/') || normalized.includes('..')) return null
  return path.join(root, 'public', normalized)
}

function clearCoverInMemories(root: string, src: string) {
  const dir = path.join(root, 'memories')
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md') || name.startsWith('_') || name.toLowerCase() === 'readme.md') {
      continue
    }
    const file = path.join(dir, name)
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw.includes(src)) continue
    const next = raw.replace(
      new RegExp(`^cover:\\s*.*${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'm'),
      'cover: ""',
    )
    if (next !== raw) fs.writeFileSync(file, next)
  }
}

export function editApiPlugin(): Plugin {
  return {
    name: 'between-us-edit-api',
    configureServer(server) {
      const root = server.config.root

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (!url.startsWith('/__edit')) return next()

        try {
          if (req.method === 'GET' && url === '/__edit/status') {
            return sendJson(res, 200, { enabled: true })
          }

          if (req.method === 'GET' && url === '/__edit/site') {
            const sitePath = path.join(root, 'src/data/site.json')
            return sendJson(res, 200, JSON.parse(fs.readFileSync(sitePath, 'utf8')))
          }

          if (req.method === 'PUT' && url === '/__edit/site') {
            const body = await readJson<{ togetherSince?: string; togetherLabel?: string }>(req)
            const sitePath = path.join(root, 'src/data/site.json')
            const current = JSON.parse(fs.readFileSync(sitePath, 'utf8')) as {
              togetherSince: string
              togetherLabel: string
            }
            const nextSite = {
              togetherSince: body.togetherSince?.trim() || current.togetherSince,
              togetherLabel: body.togetherLabel?.trim() || current.togetherLabel,
            }
            fs.writeFileSync(sitePath, `${JSON.stringify(nextSite, null, 2)}\n`)
            return sendJson(res, 200, { ok: true, site: nextSite })
          }

          if (req.method === 'GET' && url === '/__edit/notes') {
            const notesPath = path.join(root, 'src/data/notes.json')
            const list = JSON.parse(fs.readFileSync(notesPath, 'utf8'))
            // 禁止缓存：否则刷新仍可能拿到钉图之前的旧数据
            res.setHeader('Cache-Control', 'no-store')
            return sendJson(res, 200, list)
          }

          if (req.method === 'PUT' && url === '/__edit/notes') {
            const body = await readJson<unknown>(req)
            if (!Array.isArray(body)) {
              return sendJson(res, 400, { error: 'notes must be an array' })
            }
            const notesPath = path.join(root, 'src/data/notes.json')
            fs.writeFileSync(notesPath, `${JSON.stringify(body, null, 2)}\n`)
            return sendJson(res, 200, { ok: true })
          }

          if (req.method === 'PUT' && url.startsWith('/__edit/memory/')) {
            const slug = safeSlug(decodeURIComponent(url.slice('/__edit/memory/'.length)))
            if (!slug) return sendJson(res, 400, { error: 'invalid slug' })
            const body = await readJson<MemoryFields>(req)
            const file = memoryPath(root, slug)
            if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'not found' })
            fs.writeFileSync(file, serializeMemory(body))
            return sendJson(res, 200, { ok: true, slug })
          }

          if (req.method === 'DELETE' && url.startsWith('/__edit/memory/')) {
            const slug = safeSlug(decodeURIComponent(url.slice('/__edit/memory/'.length)))
            if (!slug) return sendJson(res, 400, { error: 'invalid slug' })
            const file = memoryPath(root, slug)
            if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'not found' })
            fs.unlinkSync(file)
            const photosPath = path.join(root, 'memories/_photos.json')
            if (fs.existsSync(photosPath)) {
              const list = JSON.parse(fs.readFileSync(photosPath, 'utf8')) as PhotoItem[]
              const next = list.map((item) =>
                item.slug === slug ? { ...item, slug: undefined } : item,
              )
              fs.writeFileSync(photosPath, `${JSON.stringify(next, null, 2)}\n`)
            }
            return sendJson(res, 200, { ok: true, slug })
          }

          if (req.method === 'POST' && url === '/__edit/memory') {
            const body = await readJson<MemoryFields & { slug?: string }>(req)
            const short =
              (body.slug || body.title || '未命名')
                .replace(/[\\/:*?"<>|]/g, '')
                .trim()
                .slice(0, 40) || '未命名'
            const slug = `${body.date || '1970-01-01'}-${short}`
            if (!safeSlug(slug)) return sendJson(res, 400, { error: 'invalid slug' })
            const file = memoryPath(root, slug)
            if (fs.existsSync(file)) return sendJson(res, 409, { error: 'already exists', slug })
            fs.writeFileSync(file, serializeMemory(body))
            return sendJson(res, 200, { ok: true, slug })
          }

          if (req.method === 'PUT' && url === '/__edit/photos') {
            const body = await readJson<PhotoItem[]>(req)
            const file = path.join(root, 'memories/_photos.json')
            fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`)
            return sendJson(res, 200, { ok: true })
          }

          if (req.method === 'DELETE' && url === '/__edit/photo') {
            const body = await readJson<{ src?: string }>(req)
            const src = body.src?.trim()
            if (!src) return sendJson(res, 400, { error: 'src required' })
            const photosPath = path.join(root, 'memories/_photos.json')
            const list = JSON.parse(fs.readFileSync(photosPath, 'utf8')) as PhotoItem[]
            const next = list.filter((item) => item.src !== src)
            fs.writeFileSync(photosPath, `${JSON.stringify(next, null, 2)}\n`)
            clearCoverInMemories(root, src)
            const disk = photoFileFromSrc(root, src)
            if (disk && fs.existsSync(disk)) fs.unlinkSync(disk)
            return sendJson(res, 200, { ok: true, src })
          }

          if (req.method === 'POST' && url === '/__edit/upload') {
            const buf = await readBody(req)
            const contentType = req.headers['content-type'] || ''
            const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
            if (!match) return sendJson(res, 400, { error: 'multipart required' })
            const boundary = match[1] || match[2]
            const parts = buf.toString('binary').split(`--${boundary}`)
            let filename = `upload-${Date.now()}.jpg`
            let fileData: Buffer | null = null
            for (const part of parts) {
              if (!part.includes('Content-Disposition')) continue
              const nameMatch = /filename="([^"]+)"/i.exec(part)
              if (!nameMatch) continue
              filename = path.basename(nameMatch[1]).replace(/[^\w.\u4e00-\u9fff-]+/g, '_')
              const idx = part.indexOf('\r\n\r\n')
              if (idx === -1) continue
              const binary = part.slice(idx + 4).replace(/\r\n$/, '').replace(/\r\n--$/, '')
              fileData = Buffer.from(binary, 'binary')
              break
            }
            if (!fileData) return sendJson(res, 400, { error: 'no file' })
            const ext = path.extname(filename) || '.jpg'
            const base = path.basename(filename, ext) || `photo-${Date.now()}`
            const safeName = `${base}${ext}`
            const dest = path.join(root, 'public/photos', safeName)
            fs.writeFileSync(dest, fileData)
            const src = `./photos/${safeName}`
            const photosPath = path.join(root, 'memories/_photos.json')
            const list = JSON.parse(fs.readFileSync(photosPath, 'utf8')) as PhotoItem[]
            list.push({ src, title: base })
            fs.writeFileSync(photosPath, `${JSON.stringify(list, null, 2)}\n`)
            return sendJson(res, 200, { ok: true, src, title: base })
          }

          return sendJson(res, 404, { error: 'unknown edit route' })
        } catch (error) {
          console.error('[edit-api]', error)
          return sendJson(res, 500, {
            error: error instanceof Error ? error.message : 'server error',
          })
        }
      })
    },
  }
}
