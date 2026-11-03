import Taro from '@tarojs/taro'
import { CLOUD_ENV_ID } from '../config/couple'
import { ensureCloudInit, friendlyCloudError } from './cloudInit'
import type { Memory, StickyNote } from './types'

function cloudReady() {
  if (!CLOUD_ENV_ID || !Taro.cloud) return false
  try {
    ensureCloudInit()
    return true
  } catch {
    return false
  }
}

export async function fetchWallNotes(): Promise<StickyNote[] | null> {
  if (!cloudReady()) return null
  try {
    const db = Taro.cloud.database()
    const res = await db.collection('wall_notes').limit(200).get()
    const rows = (res.data || []) as StickyNote[]
    return rows.length ? rows : null
  } catch (err) {
    console.warn('fetchWallNotes', err)
    return null
  }
}

export async function saveWallNotes(notes: StickyNote[]): Promise<boolean> {
  if (!cloudReady()) return false
  try {
    await Taro.cloud.callFunction({
      name: 'saveWall',
      data: { notes },
    })
    return true
  } catch (err) {
    console.warn('saveWallNotes', err)
    return false
  }
}

export async function uploadWallPhoto(filePath: string): Promise<string | null> {
  if (!cloudReady()) return null
  const cloudPath = `photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  try {
    const up = await Taro.cloud.uploadFile({
      cloudPath,
      filePath,
    })
    return up.fileID
  } catch (err) {
    console.warn('uploadWallPhoto', err)
    return null
  }
}

export async function fetchMemoriesCloud(): Promise<Memory[] | null> {
  if (!cloudReady()) return null
  try {
    const db = Taro.cloud.database()
    const res = await db.collection('memories').limit(200).get()
    const rows = (res.data || []) as Memory[]
    return rows.length ? rows : null
  } catch (err) {
    console.warn('fetchMemoriesCloud', err)
    return null
  }
}

export async function bindCoupleIdentity(who: 'her' | 'me') {
  if (!cloudReady()) return
  try {
    await Taro.cloud.callFunction({
      name: 'bindIdentity',
      data: { who },
    })
  } catch (err) {
    console.warn('bindCoupleIdentity', err)
  }
}

export async function callRoom(action: string, payload: Record<string, unknown> = {}) {
  if (!cloudReady()) {
    throw new Error('未开通云开发')
  }
  try {
    ensureCloudInit()
    const res = await Taro.cloud.callFunction({
      name: 'roomRelay',
      data: { action, ...payload },
    })
    return (res.result || {}) as Record<string, unknown>
  } catch (err) {
    throw new Error(friendlyCloudError(err))
  }
}
