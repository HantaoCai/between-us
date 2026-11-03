import { useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getWho, whoLabel } from '../../../lib/identity'
import { useCoupleRoom } from '../../../lib/useCoupleRoom'

type Msg =
  | { type: 'ready'; who: string }
  | { type: 'go'; at: number }
  | { type: 'tap'; who: string; ms: number }

export default function ReactionPage() {
  const who = getWho()!
  const [score, setScore] = useState({ her: 0, me: 0 })
  const [phase, setPhase] = useState<'idle' | 'wait' | 'go'>('idle')
  const goAt = useRef(0)
  const room = useCoupleRoom({
    onData: (raw) => {
      const msg = raw as Msg
      if (msg?.type === 'go') {
        goAt.current = msg.at
        setPhase('go')
      }
      if (msg?.type === 'tap' && msg.who !== who) {
        setScore((s) => {
          const next = { ...s, [msg.who]: (s as any)[msg.who] + 1 }
          return next
        })
        setPhase('idle')
      }
    },
  })

  function start() {
    setPhase('wait')
    const delay = 1200 + Math.floor(Math.random() * 2500)
    setTimeout(() => {
      const at = Date.now()
      goAt.current = at
      setPhase('go')
      room.sendReliable({ type: 'go', at })
    }, delay)
  }

  function tap() {
    if (phase !== 'go') {
      Taro.showToast({ title: '太早了', icon: 'none' })
      return
    }
    const ms = Date.now() - goAt.current
    room.sendReliable({ type: 'tap', who, ms })
    setScore((s) => ({ ...s, [who]: s[who] + 1 }))
    setPhase('idle')
  }

  return (
    <View className='bu-page'>
      <Text className='bu-title'>反应力</Text>
      <Text className='bu-sub'>{whoLabel(who)} · 先到 5 分</Text>
      <View className='bu-card'>
        <Text>软绵绵 {score.her}</Text>
        <Text>铁憨憨 {score.me}</Text>
      </View>
      <View
        className='bu-btn'
        style={{ background: phase === 'go' ? '#3d6b5a' : '#9aa59c', height: '200rpx' }}
        onClick={phase === 'go' ? tap : start}
      >
        {phase === 'idle' ? '开始' : phase === 'wait' ? '等绿灯…' : '点！'}
      </View>
    </View>
  )
}
