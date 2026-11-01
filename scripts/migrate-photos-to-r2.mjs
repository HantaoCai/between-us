#!/usr/bin/env node
/**
 * 把 public/photos 推到 Cloudflare R2（经 Worker /edit/object），
 * 并把 notes / _photos / 回忆 cover 里的 ./photos/… 改成 Worker 的 /media/… URL。
 *
 * 用法：
 *   node scripts/migrate-photos-to-r2.mjs           # 上传 + 改本地引用 + 写 R2 notes（不删图）
 *   node scripts/migrate-photos-to-r2.mjs --dry     # 只打印，不上传
 *   node scripts/migrate-photos-to-r2.mjs --purge   # 仅当上传与抽查都成功后，再删本地大图
 *
 * 务必：先不加 --purge 跑通 → 浏览器打开 /media/photos/… 与 Pages 墙面 → 再 --purge。
 * 未验证前不要从 GitHub 删 public/photos。
 *
 * 需要：
 *   1. Worker 已 Deploy 最新 worker.js，且 Binding MEDIA → R2
 *   2. 项目根 .env 里 VITE_JEV_PROXY_URL（可选 VITE_JEV_PROXY_TOKEN）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dry = process.argv.includes('--dry')
const purge = process.argv.includes('--purge')

const DEFAULT_PROXY = 'https://dry-term-0bf5.davis121776003.workers.dev'

function loadEnvFile() {
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (!(k in process.env)) process.env[k] = v
  }
}

function mediaUrl(base, key) {
  return `${base.replace(/\/$/, '')}/media/${key}`
}

function rewritePhotoRefs(text, base) {
  return text.replace(
    /(?:\.\/)?photos\/(thumbs\/)?([^"'\\s)]+)/g,
    (_m, thumb, name) => {
      const key = thumb ? `photos/thumbs/${name}` : `photos/${name}`
      return mediaUrl(base, key)
    },
  )
}

async function putObject(base, token, key, filePath) {
  const buf = fs.readFileSync(filePath)
  const form = new FormData()
  const type =
    key.endsWith('.png')
      ? 'image/png'
      : key.endsWith('.webp')
        ? 'image/webp'
        : key.endsWith('.gif')
          ? 'image/gif'
          : 'image/jpeg'
  form.append('file', new Blob([buf], { type }), path.basename(filePath))
  form.append('key', key)
  const headers = {}
  if (token) headers['X-Between-Us-Token'] = token
  const res = await fetch(`${base}/edit/object`, {
    method: 'POST',
    headers,
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return data
}

async function putNotes(base, token, notes) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['X-Between-Us-Token'] = token
  const res = await fetch(`${base}/edit/notes`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(notes),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`)
  }
}

function listPhotoFiles(dir, prefixKeys) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || name.toLowerCase() === 'readme.md') continue
    const abs = path.join(dir, name)
    const st = fs.statSync(abs)
    if (st.isDirectory()) {
      if (name === 'thumbs') {
        out.push(...listPhotoFiles(abs, [...prefixKeys, 'thumbs']))
      }
      continue
    }
    if (!/\.(jpe?g|png|webp|gif)$/i.test(name)) continue
    const key = ['photos', ...prefixKeys, name].join('/')
    out.push({ abs, key, name })
  }
  return out
}

loadEnvFile()
const base = (process.env.VITE_JEV_PROXY_URL || DEFAULT_PROXY).replace(/\/$/, '')
const token = (process.env.VITE_JEV_PROXY_TOKEN || '').trim()

console.log(`Worker: ${base}`)
console.log(dry ? '模式: dry-run' : '模式: 上传并改引用')

const statusRes = await fetch(`${base}/edit/status`)
const status = await statusRes.json().catch(() => ({}))
if (!status.enabled && !status.media) {
  console.error('Worker 未启用编辑 / 未绑定 R2（MEDIA）。请先 Deploy 并绑桶。')
  console.error(status)
  process.exit(1)
}

const photosDir = path.join(root, 'public/photos')
const files = listPhotoFiles(photosDir, [])
if (files.length === 0) {
  console.error('public/photos 下没有可上传的图片')
  process.exit(1)
}

console.log(`待上传 ${files.length} 个文件`)

let failed = 0
for (const f of files) {
  process.stdout.write(`  ${f.key} … `)
  if (dry) {
    console.log('skip')
    continue
  }
  try {
    await putObject(base, token, f.key, f.abs)
    console.log('ok')
  } catch (e) {
    failed += 1
    console.log('FAIL', e instanceof Error ? e.message : e)
  }
}

if (failed) {
  console.error(`有 ${failed} 个上传失败，已中止改引用`)
  process.exit(1)
}

const notesPath = path.join(root, 'src/data/notes.json')
const photosJsonPath = path.join(root, 'memories/_photos.json')
const memoriesDir = path.join(root, 'memories')

function rewriteFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const next = rewritePhotoRefs(raw, base)
  if (next === raw) return false
  if (!dry) fs.writeFileSync(filePath, next.endsWith('\n') ? next : `${next}\n`)
  return true
}

console.log('改写本地引用 → Worker /media/…')
const touched = []
if (fs.existsSync(notesPath) && rewriteFile(notesPath)) touched.push('src/data/notes.json')
if (fs.existsSync(photosJsonPath) && rewriteFile(photosJsonPath)) {
  touched.push('memories/_photos.json')
}
for (const name of fs.readdirSync(memoriesDir)) {
  if (!name.endsWith('.md') || name.startsWith('_')) continue
  const p = path.join(memoriesDir, name)
  if (rewriteFile(p)) touched.push(`memories/${name}`)
}
console.log(touched.length ? `已改: ${touched.join(', ')}` : '没有需要改写的引用')

if (!dry) {
  const notes = JSON.parse(fs.readFileSync(notesPath, 'utf8'))
  console.log('写入 R2 data/notes.json …')
  await putNotes(base, token, notes)
  console.log('ok')
}

if (purge && !dry) {
  console.log('删除本地大图（保留 public/photos/README.md）…')
  for (const f of files) {
    fs.unlinkSync(f.abs)
  }
  const thumbsDir = path.join(photosDir, 'thumbs')
  if (fs.existsSync(thumbsDir)) {
    fs.rmSync(thumbsDir, { recursive: true, force: true })
  }
  console.log('本地图片已删。请提交：gitignore 已忽略照片，git 里也会去掉已跟踪文件。')
}

console.log(`
下一步：
  1. Cloudflare Worker 已贴最新 worker.js 并 Deploy（含 /edit/object）
  2. git add -A && 提交（照片不再进仓库）
  3. 推送后打开 GitHub Pages，墙面应加载 R2 图
`)
