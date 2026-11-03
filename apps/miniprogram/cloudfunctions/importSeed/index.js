/**
 * 一次性导入：在云函数里手动传入 notes / memories 数组，或本地用 scripts/upload-seed 调。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const couple = await db.collection('couple').where({ openid: OPENID }).limit(1).get()
  if (!couple.data[0]) return { ok: false, error: '未绑定身份' }

  let notesCount = 0
  let memCount = 0
  if (Array.isArray(event.notes)) {
    const col = db.collection('wall_notes')
    for (const note of event.notes.slice(0, 200)) {
      await col.add({ data: { ...note, importedAt: Date.now() } })
      notesCount++
    }
  }
  if (Array.isArray(event.memories)) {
    const col = db.collection('memories')
    for (const m of event.memories.slice(0, 200)) {
      await col.add({ data: { ...m, importedAt: Date.now() } })
      memCount++
    }
  }
  return { ok: true, notesCount, memCount }
}
