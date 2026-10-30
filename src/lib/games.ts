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

export const games: GameInfo[] = [
  {
    id: 'guess',
    title: '猜数字',
    blurb: '各想一个数，提交后一起猜，看谁先对满位。',
    path: '/games/guess',
    tag: '双人',
    cover: 'games/guess.jpg',
    needsRoom: true,
  },
  {
    id: 'quiz',
    title: '答题对战',
    blurb: '同题作答，八题定胜负。',
    path: '/games/quiz',
    tag: '双人',
    cover: 'games/quiz.jpg',
    needsRoom: true,
  },
  {
    id: 'draw',
    title: '你画我猜',
    blurb: '一人画一人猜，轮流加分。',
    path: '/games/draw',
    tag: '双人',
    cover: 'games/draw.jpg',
    needsRoom: true,
  },
  {
    id: 'poker',
    title: '简化德州',
    blurb: '双人德州，盲注开打，比牌型。',
    path: '/games/poker',
    tag: '双人',
    cover: 'games/poker.jpg',
    needsRoom: true,
  },
  {
    id: 'dice',
    title: '掷骰子',
    blurb: '各掷各的。可以不公开，重摇时对方仍看得到。',
    path: '/games/dice',
    tag: '合作',
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
  {
    id: 'flip',
    title: '翻翻乐',
    blurb: '同一副牌轮流翻，一起把配对清完。',
    path: '/games/flip',
    tag: '合作',
    cover: 'games/flip.jpg',
    needsRoom: true,
  },
]

export const roomGames = games.filter((g) => g.needsRoom)
