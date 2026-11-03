import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import { getWho, whoLabel } from '../../../lib/identity'
import { useCoupleRoom } from '../../../lib/useCoupleRoom'

type Msg = { type: 'dice'; who: string; value: number }

export default function DicePage() {
  const who = getWho()
  const [mine, setMine] = useState<number | null>(null)
  const [peer, setPeer] = useState<number | null>(null)
  const [hidden, setHidden] = useState(false)
  const room = useCoupleRoom({
    onData: (raw) => {
      const msg = raw as Msg
      if (msg?.type === 'dice' && msg.who !== who) setPeer(msg.value)
    },
  })

  function roll() {
    const value = 1 + Math.floor(Math.random() * 6)
    setMine(value)
    room.sendReliable({ type: 'dice', who, value } satisfies Msg)
  }

  return (
    <View className='bu-page'>
      <Text className='bu-title'>掷骰子</Text>
      <Text className='bu-sub'>
        {whoLabel(who)} · {room.peer ? '对方在线' : '等对方'} · {room.ready ? '已进房' : '连接中'}
      </Text>
      <View className='bu-card'>
        <Text>我：{hidden ? '?' : mine ?? '-'}</Text>
        <Text>对方：{peer ?? '-'}</Text>
      </View>
      <View className='bu-btn' onClick={roll}>
        再掷一次
      </View>
      <View className='bu-btn bu-btn-ghost' style={{ marginTop: '16rpx' }} onClick={() => setHidden((v) => !v)}>
        {hidden ? '公开我的点数' : '先不公开'}
      </View>
    </View>
  )
}
