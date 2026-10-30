export const drawWords = [
  '猫',
  '下雨',
  '咖啡',
  '月亮',
  '自行车',
  '火锅',
  '相机',
  '雪山',
  '伞',
  '吉他',
  '面条',
  '大象',
  '飞机',
  '西瓜',
  '书架',
  '彩虹',
  '企鹅',
  '网球',
  '城堡',
  '草莓',
  '耳机',
  '露营',
  '海豚',
  '气球',
]

export function randomDrawWord(exclude?: string) {
  const pool = exclude ? drawWords.filter((w) => w !== exclude) : drawWords
  return pool[Math.floor(Math.random() * pool.length)]
}
