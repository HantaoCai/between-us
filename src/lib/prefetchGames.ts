/** 首页空闲 / 点按导航时预取，避免墙面照片占满带宽时点「小游戏」像没反应 */
export function prefetchGamesRoute() {
  void import('./PeerRoomContext')
  void import('../pages/GamesPage')
}
