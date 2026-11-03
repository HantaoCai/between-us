import Taro from '@tarojs/taro'
import { COUPLE_ROOM_CODE, CLOUD_ENV_ID } from '../config/couple'
import { callRoom } from './cloudApi'
import { getWho } from './identity'

export type RoomHandlers = {
  onData: (data: unknown) => void
  onOpen?: () => void
  onPeer?: (present: boolean) => void
  onError?: (msg: string) => void
}

type WatchHandle = { close: () => void }

/**
 * 固定情侣房：云数据库 rooms + room_events 实时同步。
 * 无云环境时降级为本地单机回环（方便开发者工具自测 UI）。
 */
export class CoupleRoom {
  code = COUPLE_ROOM_CODE
  isHost = false
  private handlers: RoomHandlers
  private watch: WatchHandle | null = null
  private localBus: ((data: unknown) => void) | null = null

  constructor(handlers: RoomHandlers) {
    this.handlers = handlers
  }

  async connect() {
    const who = getWho()
    if (!who) throw new Error('请先选择身份')

    if (!CLOUD_ENV_ID) {
      this.isHost = true
      this.handlers.onOpen?.()
      this.handlers.onPeer?.(false)
      // 本地回环：发给自己，便于单机点按钮看反馈
      this.localBus = (data) => this.handlers.onData(data)
      return this
    }

    const joined = await callRoom('join', {
      code: this.code,
      who,
    })
    this.isHost = !!joined.isHost
    this.handlers.onOpen?.()
    this.handlers.onPeer?.(!!joined.peerPresent)

    const db = Taro.cloud.database()
    this.watch = db
      .collection('room_events')
      .where({ code: this.code })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .watch({
        onChange: (snap) => {
          const docs = snap.docs || []
          const last = docs[0] as { fromWho?: string; payload?: unknown } | undefined
          if (!last?.payload) return
          if (last.fromWho === who) return
          this.handlers.onData(last.payload)
          this.handlers.onPeer?.(true)
        },
        onError: (err) => {
          console.warn('room watch', err)
          this.handlers.onError?.('房间监听失败')
        },
      })

    return this
  }

  send(data: unknown) {
    if (this.localBus) {
      this.localBus(data)
      return
    }
    const who = getWho()
    void callRoom('send', {
      code: this.code,
      who,
      payload: data,
    }).catch((err) => {
      console.warn('room send', err)
      this.handlers.onError?.('发送失败')
    })
  }

  sendReliable(data: unknown, times = 3) {
    this.send(data)
    for (let i = 1; i < times; i++) {
      setTimeout(() => this.send(data), 250 * i)
    }
  }

  destroy() {
    try {
      this.watch?.close()
    } catch {
      /* ignore */
    }
    this.watch = null
    this.localBus = null
  }
}
