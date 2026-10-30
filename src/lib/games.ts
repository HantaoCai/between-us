export type GameInfo = {
  id: string
  title: string
  blurb: string
  path: string
  tag: string
  cover: string
}

export const games: GameInfo[] = [
  {
    id: 'guess',
    title: '猜数字',
    blurb: '各想一个数，提交后一起猜，看谁先对满位。',
    path: '/games/guess',
    tag: '双人',
    cover: 'games/guess.jpg',
  },
  {
    id: 'quiz',
    title: '答题对战',
    blurb: '同题作答，八题定胜负。',
    path: '/games/quiz',
    tag: '双人',
    cover: 'games/quiz.jpg',
  },
  {
    id: 'draw',
    title: '你画我猜',
    blurb: '一人画一人猜，轮流加分。',
    path: '/games/draw',
    tag: '双人',
    cover: 'games/draw.jpg',
  },
  {
    id: 'poker',
    title: '简化德州',
    blurb: '双人德州，盲注开打，比牌型。',
    path: '/games/poker',
    tag: '双人',
    cover: 'games/poker.jpg',
  },
  {
    id: 'dice',
    title: '掷骰子',
    blurb: '掷一颗或两颗，或抛硬币做决定。',
    path: '/games/dice',
    tag: '随便',
    cover: 'games/dice.jpg',
  },
  {
    id: 'reaction',
    title: '反应力',
    blurb: '绿了再点，比比谁手更快。',
    path: '/games/reaction',
    tag: '挑战',
    cover: 'games/reaction.jpg',
  },
  {
    id: 'flip',
    title: '翻翻乐',
    blurb: '翻开相同的一对，锻炼默契和记忆。',
    path: '/games/flip',
    tag: '双人',
    cover: 'games/flip.jpg',
  },
]
