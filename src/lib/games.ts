export type GameInfo = {
  id: string
  title: string
  blurb: string
  path: string
  tag: string
  cover: string
  /** 需要先开房间，再两个人一起玩 */
  needsRoom: boolean
}

/** 同类型相邻：升温 → 脑力 → 棋牌 → 合作 → 对抗 → 休闲 → 竞技 */
export const games: GameInfo[] = [
  {
    id: 'chemistry',
    title: '默契问答',
    blurb: '同题各选答案，选一样算合拍，看默契度。',
    path: '/games/chemistry',
    tag: '升温',
    cover: 'games/chemistry.jpg',
    needsRoom: true,
  },
  {
    id: 'guess',
    title: '猜数字',
    blurb: '各想一个数，提交后一起猜，看谁先对满位。',
    path: '/games/guess',
    tag: '脑力',
    cover: 'games/guess.jpg',
    needsRoom: true,
  },
  {
    id: 'quiz',
    title: '答题对战',
    blurb: '同题作答，八题定胜负。',
    path: '/games/quiz',
    tag: '脑力',
    cover: 'games/quiz.jpg',
    needsRoom: true,
  },
  {
    id: 'poker',
    title: '双人德州',
    blurb: '盲注开打，比牌型。',
    path: '/games/poker',
    tag: '棋牌',
    cover: 'games/poker.jpg',
    needsRoom: true,
  },
  {
    id: 'gomoku',
    title: '五子棋',
    blurb: '15 路棋盘对弈，可选黑棋禁手。',
    path: '/games/gomoku',
    tag: '棋牌',
    cover: 'games/gomoku.jpg',
    needsRoom: true,
  },
  {
    id: 'draw',
    title: '你画我猜',
    blurb: '一人画一人猜，轮流加分。',
    path: '/games/draw',
    tag: '合作',
    cover: 'games/draw.jpg',
    needsRoom: true,
  },
  {
    id: 'selfdraw',
    title: '你画你猜',
    blurb: '对方出题你限时画，干扰后再认自己的画。',
    path: '/games/selfdraw',
    tag: '脑力',
    cover: 'games/selfdraw.jpg',
    needsRoom: true,
  },
  {
    id: 'flip',
    title: '翻翻乐',
    blurb: '6×6 对战翻牌：配对连击得分，偷窥·洗牌·炸弹搅局。',
    path: '/games/flip',
    tag: '对抗',
    cover: 'games/flip.jpg',
    needsRoom: true,
  },
  {
    id: 'dice',
    title: '掷骰子',
    blurb: '各掷各的。一摇就藏着，开了才公开，再摇又藏起来。',
    path: '/games/dice',
    tag: '休闲',
    cover: 'games/dice.jpg',
    needsRoom: true,
  },
  {
    id: 'reaction',
    title: '反应力',
    blurb: '一起等绿灯，比谁点得更快，先到五分赢。',
    path: '/games/reaction',
    tag: '竞技',
    cover: 'games/reaction.jpg',
    needsRoom: true,
  },
]

export const roomGames = games.filter((g) => g.needsRoom)
