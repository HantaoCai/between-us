import { useState } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getWho, whoLabel } from '../../../lib/identity'
import { useCoupleRoom } from '../../../lib/useCoupleRoom'

function hits(secret: string, guess: string) {
  let n = 0
  for (let i = 0; i < 4; i++) if (secret[i] === guess[i]) n++
  return n
}

type Msg =
  | { type: 'secret'; who: string; value: string }
  | { type: 'guess'; who: string; value: string }

export default function GuessPage() {
  const who = getWho()!
  const [secret, setSecret] = useState('')
  const [peerSecret, setPeerSecret] = useState('')
  const [guess, setGuess] = useState('')
  const [log, setLog] = useState<string[]>([])
  const room = useCoupleRoom({
    onData: (raw) => {
      const msg = raw as Msg
      if (msg?.type === 'secret' && msg.who !== who) setPeerSecret(msg.value)
      if (msg?.type === 'guess' && msg.who !== who && secret) {
        setLog((L) => [`对方猜 ${msg.value} → ${hits(secret, msg.value)} 位对`, ...L])
      }
    },
  })

  function commitSecret() {
    if (!/^\d{4}$/.test(secret)) {
      Taro.showToast({ title: '请输入 4 位数字', icon: 'none' })
      return
    }
    room.sendReliable({ type: 'secret', who, value: secret })
  }

  function commitGuess() {
    if (!/^\d{4}$/.test(guess) || !peerSecret) {
      Taro.showToast({ title: peerSecret ? '输入 4 位' : '等对方设密', icon: 'none' })
      return
    }
    const n = hits(peerSecret, guess)
    setLog((L) => [`我猜 ${guess} → ${n} 位对`, ...L])
    room.sendReliable({ type: 'guess', who, value: guess })
    if (n === 4) Taro.showToast({ title: '猜中了！', icon: 'success' })
  }

  return (
    <View className='bu-page'>
      <Text className='bu-title'>猜数字</Text>
      <Text className='bu-sub'>{whoLabel(who)} · 4 位，位置也对才算</Text>
      <View className='bu-card'>
        <Text>我的秘密</Text>
        <Input value={secret} maxlength={4} type='number' onInput={(e) => setSecret(e.detail.value)} />
        <View className='bu-btn' style={{ marginTop: '12rpx' }} onClick={commitSecret}>
          锁定并同步
        </View>
      </View>
      <View className='bu-card'>
        <Text>猜对方</Text>
        <Input value={guess} maxlength={4} type='number' onInput={(e) => setGuess(e.detail.value)} />
        <View className='bu-btn' style={{ marginTop: '12rpx' }} onClick={commitGuess}>
          提交猜测
        </View>
      </View>
      {log.map((line, i) => (
        <Text key={i} className='bu-sub'>
          {line}
        </Text>
      ))}
    </View>
  )
}
