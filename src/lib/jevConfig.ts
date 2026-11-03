import {
  cloudProxyBaseUrl,
  cloudProxyToken,
  isCloudProxyConfigured,
} from './proxyConfig'

/** Jev 人机走同一 Cloudflare Worker；配置与 cloudProxy* 相同 */
export const isJevConfigured = isCloudProxyConfigured

/** @deprecated 用 cloudProxyBaseUrl */
export const jevProxyBaseUrl = cloudProxyBaseUrl
/** @deprecated 用 cloudProxyToken */
export const jevProxyToken = cloudProxyToken
