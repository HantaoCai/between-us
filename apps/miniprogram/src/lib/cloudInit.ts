import Taro from '@tarojs/taro'
import { CLOUD_ENV_ID } from '../config/couple'

let inited = false

/** 任意云调用前确保 init；环境不对时抛出可读中文错误 */
export function ensureCloudInit() {
  if (!CLOUD_ENV_ID) {
    throw new Error('未配置云环境 ID')
  }
  if (!Taro.cloud) {
    throw new Error('当前基础库不支持云开发，请升级开发者工具/基础库')
  }
  if (!inited) {
    Taro.cloud.init({
      env: CLOUD_ENV_ID,
      traceUser: true,
    })
    inited = true
  }
}

export function friendlyCloudError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/Environment not found|-501000|INVALID_ENV/i.test(msg)) {
    return `云环境找不到（${CLOUD_ENV_ID}）。请在开发者工具核对：详情里 AppID 是否 wx47bde352ad9b3c36；云函数目录右键是否选了同一环境；控制台「设置」里复制的是环境 ID`
  }
  return msg || '云调用失败'
}
