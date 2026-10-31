#!/usr/bin/env node
/**
 * 为 public/photos 里的原图生成墙上缩略图（最长边 360px）。
 * 依赖本机 sips（macOS）；没有 sips 时跳过并提示。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const photosDir = path.join(root, 'public/photos')
const thumbsDir = path.join(photosDir, 'thumbs')
const MAX = 360

const hasSips = spawnSync('sips', ['--help'], { encoding: 'utf8' }).status === 0
if (!hasSips) {
  console.error('需要 macOS 的 sips 才能生成缩略图')
  process.exit(1)
}

fs.mkdirSync(thumbsDir, { recursive: true })

const files = fs
  .readdirSync(photosDir)
  .filter((name) => /\.(jpe?g|png|webp|gif)$/i.test(name))

let ok = 0
for (const name of files) {
  const src = path.join(photosDir, name)
  const dest = path.join(thumbsDir, name)
  const result = spawnSync(
    'sips',
    ['-Z', String(MAX), src, '--out', dest],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    console.error(`失败 ${name}:`, result.stderr || result.stdout)
    continue
  }
  ok += 1
  const before = fs.statSync(src).size
  const after = fs.statSync(dest).size
  console.log(
    `${name}: ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB`,
  )
}

console.log(`完成 ${ok}/${files.length} → ${thumbsDir}`)
