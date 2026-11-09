/** 墙面缩略图并发闸：限流 + 可整体暂停（进小游戏时立刻停） */

const MAX_IN_FLIGHT = 4

type Waiter = () => void
type AllowedListener = (allowed: boolean) => void

let inFlight = 0
let mediaAllowed = false
const queue: Waiter[] = []
const listeners = new Set<AllowedListener>()

function pump() {
  if (!mediaAllowed) return
  while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
    const next = queue.shift()
    if (!next) break
    inFlight += 1
    next()
  }
}

/** 首页空闲后再开；点小游戏 / 离开墙面时关掉并清空排队 */
export function setWallMediaAllowed(allowed: boolean) {
  if (mediaAllowed === allowed) {
    if (allowed) pump()
    return
  }
  mediaAllowed = allowed
  if (!allowed) {
    queue.length = 0
  }
  listeners.forEach((fn) => fn(allowed))
  if (allowed) pump()
}

export function isWallMediaAllowed() {
  return mediaAllowed
}

export function subscribeWallMediaAllowed(fn: AllowedListener) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 导航去小游戏：马上停掉未开始的墙面图，把带宽让给游戏包 */
export function pauseWallPhotosForNavigation() {
  setWallMediaAllowed(false)
}

export function acquireWallPhotoSlot(
  priority: 'high' | 'low' | 'auto' = 'auto',
): Promise<() => void> {
  return new Promise((resolve) => {
    const start = () => {
      let released = false
      resolve(() => {
        if (released) return
        released = true
        inFlight = Math.max(0, inFlight - 1)
        pump()
      })
    }

    if (!mediaAllowed) {
      // 已暂停：立刻还一个空 release，调用方应自行不再挂 src
      resolve(() => {})
      return
    }

    if (priority === 'high') queue.unshift(start)
    else queue.push(start)
    pump()
  })
}
