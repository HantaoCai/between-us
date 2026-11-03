import { PropsWithChildren, useEffect } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import { CLOUD_ENV_ID } from './config/couple'
import { ensureCloudInit } from './lib/cloudInit'
import { ensureWho } from './lib/identity'
import './app.scss'

function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    if (!CLOUD_ENV_ID) {
      console.warn('未配置 CLOUD_ENV_ID，读写走本地种子数据')
      return
    }
    try {
      ensureCloudInit()
    } catch (err) {
      console.warn('cloud init failed', err)
    }
  })

  useEffect(() => {
    const pages = Taro.getCurrentPages()
    const route = pages[pages.length - 1]?.route || ''
    if (route.includes('onboarding')) return
    const who = ensureWho()
    if (!who) {
      Taro.reLaunch({ url: '/pages/onboarding/index' })
    }
  }, [])

  return children
}

export default App
