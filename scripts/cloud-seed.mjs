#!/usr/bin/env node
/**
 * 把仓库里的墙数据灌进 Cloudflare R2（通过 Worker）。
 * 用法：
 *   EDIT_API=https://....workers.dev EDIT_PASSWORD='口令' npm run cloud:seed
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
if (!password) {
  console.error('缺少 EDIT_PASSWORD')
  process.exit(1)
}

const headers = {
  'Content-Type': 'application/json',
  'X-Edit-Password': password,
}

async function putJson(pathname, data) {
  const res = await fetch(`${api}${pathname}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`${pathname} → ${res.status} ${body.error || ''}`)
  }
  return body
}

const notes = JSON.parse(fs.readFileSync(path.join(root, 'src/data/notes.json'), 'utf8'))
const photos = JSON.parse(fs.readFileSync(path.join(root, 'memories/_photos.json'), 'utf8'))

await putJson('/notes', notes)
await putJson('/photos', photos)
console.log(`已写入 notes (${notes.length})、photos (${photos.length}) → ${api}`)
console.log('说明：仓库内 ./photos/* 仍由 GitHub Pages 提供；新钉的照片会进 R2。')
