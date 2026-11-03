import { useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { getWho, whoLabel } from '../../../lib/identity'
import { useCoupleRoom } from '../../../lib/useCoupleRoom'

const BANK = [
  { q: '周末更想？', a: ['躺平', '出门浪', '做饭', '看电影'] },
  { q: '心情不好时？', a: ['想被抱', '想独处', '想吃甜的', '想吐槽'] },
  { q: '旅行偏好？', a: ['海边', '山里', '城市', '随便'] },
  { q: '早餐首选？', a: ['粥', '面包', '奶茶续命', '不吃'] },
  { q: '吵架后？', a: ['先道歉', '等对方', '冷战一下', '撒娇'] },
  { q: '理想约会？', a: ['散步', '吃饭', '在家', '惊喜行程'] },
]

type Msg = { type: 'pick'; who: string; qi: number; ai: number }

export default function QuizPage() {
  const who = getWho()!
  const [qi, setQi] = useState(0)
  const [mine, setMine] = useState<number | null>(null)
  const [peer, setPeer] = useState<number | null>(null)
  const [match, setMatch] = useState(0)
  const item = useMemo(() => BANK[qi % BANK.length], [qi])
  const room = useCoupleRoom({
    onData: (raw) => {
      const msg = raw as Msg
      if (msg?.type !== 'pick' || msg.who === who || msg.qi !== qi) return
      setPeer(msg.ai)
    },
  })

  function pick(ai: number) {
    setMine(ai)
    room.sendReliable({ type: 'pick', who, qi, ai })
  }

  function next() {
    if (mine != null && peer != null && mine === peer) setMatch((n) => n + 1)
    setQi((n) => n + 1)
    setMine(null)
    setPeer(null)
  }

  return (
    <View className='bu-page'>
      <Text className='bu-title'>默契问答</Text>
      <Text className='bu-sub'>
        {whoLabel(who)} · 合拍 {match}
      </Text>
      <View className='bu-card'>
        <Text>{item.q}</Text>
      </View>
      {item.a.map((label, ai) => (
        <View
          key={label}
          className='bu-btn'
          style={{
            marginTop: '12rpx',
            background: mine === ai ? '#2f5648' : '#3d6b5a',
          }}
          onClick={() => pick(ai)}
        >
          {label}
          {peer === ai ? ' · 对方也选了' : ''}
        </View>
      ))}
      <View className='bu-btn bu-btn-ghost' style={{ marginTop: '20rpx' }} onClick={next}>
        下一题
      </View>
    </View>
  )
}
