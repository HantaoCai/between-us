/** 两人专属配置：换成你的云环境 ID 与房号 */

/** 微信云开发环境 ID（开通云开发后填写） */
export const CLOUD_ENV_ID = 'capable-porcupine-d1ddjw55abb0c2'

/** 固定情侣房号：打开小游戏自动进这间，不再分享链接 */
export const COUPLE_ROOM_CODE = '520131'

export const ABOUT_LABEL = {
  her: '软绵绵',
  me: '铁憨憨',
} as const

export type NoteAbout = keyof typeof ABOUT_LABEL
