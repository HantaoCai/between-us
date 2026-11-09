/** 墙面缩略图并发闸：避免 30+ 张一起抢带宽，弱网下长时间空白 */

const MAX_IN_FLIGHT = 4

type Waiter = () => void

let inFlight = 0
const queue: Waiter[] = []

function pump() {
  while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
    const next = queue.shift()
    if (!next) break
    inFlight += 1
    next()
  }
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

    if (priority === 'high') queue.unshift(start)
    else queue.push(start)
    pump()
  })
}
