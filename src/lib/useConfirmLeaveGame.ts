/**
 * 以前会用路由拦截弹「对局还在进行」确认框。
 * 先开房再选游戏后，回房间 / 切游戏很频繁，弹窗一出就容易断线卡住，已改为空操作。
 */
export function useConfirmLeaveGame(_when: boolean) {
  return {
    allowNextNavigation() {
      /* no-op */
    },
  }
}
