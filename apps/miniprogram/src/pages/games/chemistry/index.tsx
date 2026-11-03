import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import { getWho, whoLabel } from '../../../lib/identity'
import { useCoupleRoom } from '../../../lib/useCoupleRoom'

const ELEMENTS = ['火', '水', '风', '土', '光', '影']
type Msg = { type: 'chem'; who: string; pick: string }

export default function ChemistryPage() {
  const who = getWho()!
  const [mine, setMine] = useState('')
  const [peer, setPeer] = useState('')
  const room = useCoupleRoom({
    onData: (raw) => {
      const msg = raw as Msg
      if (msg?.type === 'chem' && msg.who !== who) setPeer(msg.pick)
    },
  })

  function pick(el: string) {
    setMine(el)
    room.sendReliable({ type: 'chem', who, pick: el })
  }

  const fused = mine && peer ? `${mine}+${peer}=${mine === peer ? '共鸣✨' : '奇妙反应🧪'}` : ''

  return (
    <View className='bu-page'>
      <Text className='bu-title'>化学反应</Text>
      <Text className='bu-sub'>{whoLabel(who)} · 各选一个元素</Text>
      <View className='bu-card'>
        <Text>我：{mine || '-'}</Text>
        <Text>对方：{peer || '-'}</Text>
        <Text>{fused}</Text>
      </View>
      {ELEMENTS.map((el) => (
        <View key={el} className='bu-btn' style={{ marginTop: '12rpx' }} onClick={() => pick(el)}>
          {el}
        </View>
      ))}
    </View>
  )
}
