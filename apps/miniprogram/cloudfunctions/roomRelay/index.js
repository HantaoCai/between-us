const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COUPLE_ROOM = '520131'

async function getOrCreateRoom(code) {
  const col = db.collection('rooms')
  const found = await col.where({ code }).limit(1).get()
  if (found.data[0]) return found.data[0]
  const add = await col.add({
    data: {
      code,
      hostOpenId: '',
      guestOpenId: '',
      hostWho: '',
      guestWho: '',
      updatedAt: Date.now(),
    },
  })
  const doc = await col.doc(add._id).get()
  return doc.data
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action
  const code = String(event.code || COUPLE_ROOM).replace(/\D/g, '').slice(0, 6) || COUPLE_ROOM

  if (action === 'join') {
    const who = event.who === 'me' ? 'me' : 'her'
    const room = await getOrCreateRoom(code)
    const col = db.collection('rooms')
    let isHost = false
    const patch = { updatedAt: Date.now() }

    if (!room.hostOpenId || room.hostOpenId === OPENID) {
      patch.hostOpenId = OPENID
      patch.hostWho = who
      isHost = true
    } else if (!room.guestOpenId || room.guestOpenId === OPENID) {
      patch.guestOpenId = OPENID
      patch.guestWho = who
      isHost = false
    } else {
      return { ok: false, error: '房间已满' }
    }

    await col.doc(room._id).update({ data: patch })
    const peerPresent = Boolean(
      (isHost ? patch.guestOpenId || room.guestOpenId : patch.hostOpenId || room.hostOpenId),
    )
    return { ok: true, isHost, peerPresent, code }
  }

  if (action === 'send') {
    const who = event.who === 'me' ? 'me' : 'her'
    await db.collection('room_events').add({
      data: {
        code,
        fromWho: who,
        fromOpenId: OPENID,
        payload: event.payload ?? null,
        createdAt: Date.now(),
      },
    })
    return { ok: true }
  }

  return { ok: false, error: 'unknown action' }
}
