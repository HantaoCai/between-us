import {
  cloudProxyBaseUrl,
  cloudProxyToken,
  isCloudProxyConfigured,
} from './proxyConfig'

/** @deprecated 用 cloudProxy*；保留别名避免旧引用断裂 */
export const jevProxyBaseUrl = cloudProxyBaseUrl
export const jevProxyToken = cloudProxyToken
export const isJevConfigured = isCloudProxyConfigured
