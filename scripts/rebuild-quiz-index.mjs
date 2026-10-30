#!/usr/bin/env node
/** 根据 public/quiz-bank/*.json 重建 index.json / all.json / manifest.json */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('public/quiz-bank')
const cats = ['wen', 'science', 'life', 'geo', 'food', 'fun']
const all = []
const idCat = {}

for (const c of cats) {
  const file = path.join(root, `${c}.json`)
  const items = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const q of items) {
    if (q.cat !== c) q.cat = c
    idCat[q.id] = c
  }
  all.push(...items)
  console.log(c, items.length)
}

fs.writeFileSync(path.join(root, 'all.json'), `${JSON.stringify(all, null, 2)}\n`)

const updatedAt = new Date().toISOString().slice(0, 10)
const index = {
  version: 2,
  updatedAt,
  idCat,
  categories: Object.fromEntries(
    cats.map((c) => {
      const items = all.filter((q) => q.cat === c)
      return [c, { file: `${c}.json`, count: items.length, ids: items.map((q) => q.id) }]
    }),
  ),
  all: { file: 'all.json', count: all.length, ids: all.map((q) => q.id) },
}
fs.writeFileSync(path.join(root, 'index.json'), `${JSON.stringify(index)}\n`)
fs.writeFileSync(
  path.join(root, 'manifest.json'),
  `${JSON.stringify(
    {
      version: 2,
      updatedAt,
      repo: 'HantaoCai/between-us',
      path: 'public/quiz-bank',
      cdn: 'https://cdn.jsdelivr.net/gh/HantaoCai/between-us@main/public/quiz-bank',
      categories: Object.fromEntries(
        cats.map((c) => [
          c,
          { file: `${c}.json`, count: all.filter((q) => q.cat === c).length },
        ]),
      ),
      all: { file: 'all.json', count: all.length },
    },
    null,
    2,
  )}\n`,
)
console.log('total', all.length)
