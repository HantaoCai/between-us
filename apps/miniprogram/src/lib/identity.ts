import Taro from '@tarojs/taro'
import { ABOUT_LABEL, type NoteAbout } from '../config/couple'

const WHO_KEY = 'bu_who'

export function getWho(): NoteAbout | null {
  const v = Taro.getStorageSync(WHO_KEY)
  return v === 'her' || v === 'me' ? v : null
}

export function setWho(who: NoteAbout) {
  Taro.setStorageSync(WHO_KEY, who)
}

/** 已选身份则返回；未选返回 null（由 App 跳转 onboarding） */
export function ensureWho(): NoteAbout | null {
  return getWho()
}

export function whoLabel(who: NoteAbout | null | undefined) {
  if (!who) return '未选'
  return ABOUT_LABEL[who]
}

export function otherWho(who: NoteAbout): NoteAbout {
  return who === 'her' ? 'me' : 'her'
}
