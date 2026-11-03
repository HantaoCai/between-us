const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const who = event.who === 'me' ? 'me' : 'her'
  const couple = db.collection('couple')
  const existing = await couple.where({ openid: OPENID }).limit(1).get()
  if (existing.data[0]) {
    await couple.doc(existing.data[0]._id).update({
      data: { who, updatedAt: Date.now() },
    })
  } else {
    await couple.add({
      data: { openid: OPENID, who, createdAt: Date.now(), updatedAt: Date.now() },
    })
  }
  return { ok: true, who, openid: OPENID }
}
