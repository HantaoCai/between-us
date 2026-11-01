#!/usr/bin/env node
/**
 * 从线上 Worker 拉回墙数据；远端绝对地址的照片下载到 public/photos/。
 * 用法：
 *   EDIT_API=https://....workers.dev EDIT_PASSWORD='口令' npm run cloud:backup
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const api = (process.env.EDIT_API || process.env.VITE_EDIT_API || '').replace(/\/$/, '')
const password = process.env.EDIT_PASSWORD || ''

if (!api) {
  console.error('缺少 EDIT_API（Worker URL）')
  process.exit(1)
}

const headers = password ? { 'X-Edit-Password': password } : {}

async function getJson(pathname) {
  const res = await fetch(`${api}${pathname}`, { headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`${pathname} → ${res.status} ${body.error || ''}`)
  }
  return body
}

function fileNameFromSrc(src) {
  try {
    if (/^https?:\/\//i.test(src)) {
      const url = new URL(src)
      return path.basename(url.pathname)
    }
  } catch {
    /* fall through */
  }
  return path.basename(src.replace(/^\.\//, ''))
}

const notes = await getJson('/notes')
if (!Array.isArray(notes)) {
  throw new Error('notes 不是数组')
}

const photosDir = path.join(root, 'public/photos')
fs.mkdirSync(photosDir, { recursive: true })

const rewritten = []
for (const note of notes) {
  const src = typeof note?.src === 'string' ? note.src.trim() : ''
  if (!src || !/^https?:\/\//i.test(src)) {
    rewritten.push(note)
    continue
  }
  const name = fileNameFromSrc(src)
  const dest = path.join(photosDir, name)
  const res = await fetch(src)
  if (!res.ok) {
    console.warn(`跳过下载失败 ${src} → ${res.status}`)
    rewritten.push(note)
    continue
  }
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
  console.log(`照片 ${name} (${buf.length} bytes)`)
  rewritten.push({ ...note, src: `./photos/${name}` })
}

const notesPath = path.join(root, 'src/data/notes.json')
fs.writeFileSync(notesPath, `${JSON.stringify(rewritten, null, 2)}\n`)
console.log(`已写回 ${notesPath}（${rewritten.length} 条）`)

try {
  const photos = await getJson('/photos')
  if (Array.isArray(photos)) {
    const localPhotos = photos.map((item) => {
      const src = String(item.src || '')
      if (!/^https?:\/\//i.test(src)) return item
      const name = fileNameFromSrc(src)
      return { ...item, src: `./photos/${name}` }
    })
    const photosPath = path.join(root, 'memories/_photos.json')
    fs.writeFileSync(photosPath, `${JSON.stringify(localPhotos, null, 2)}\n`)
    console.log(`已写回 ${photosPath}（${localPhotos.length} 条）`)
  }
} catch (err) {
  console.warn('photos 元数据未备份：', err instanceof Error ? err.message : err)
}

console.log('备份完成。可提交 git，或再跑 npm run photos:thumbs 生成缩略图。')
