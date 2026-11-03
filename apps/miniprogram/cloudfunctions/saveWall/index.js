const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function assertCouple(openid) {
  const res = await db.collection('couple').where({ openid }).limit(1).get()
  if (!res.data[0]) throw new Error('未绑定情侣身份')
  return res.data[0]
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  await assertCouple(OPENID)
  const notes = Array.isArray(event.notes) ? event.notes : []
  const col = db.collection('wall_notes')
  // 简化：清空后重建（两人专属、数据量小）
  const old = await col.limit(200).get()
  for (const row of old.data) {
    await col.doc(row._id).remove()
  }
  for (const note of notes.slice(0, 200)) {
    await col.add({ data: { ...note, updatedAt: Date.now() } })
  }
  return { ok: true, count: Math.min(notes.length, 200) }
}
