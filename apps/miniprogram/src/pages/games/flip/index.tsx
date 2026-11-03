import { useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { getWho, whoLabel } from '../../../lib/identity'
import { useCoupleRoom } from '../../../lib/useCoupleRoom'

const EMOJIS = ['🌸', '🍀', '⭐', '🌙', '🍓', '🧸', '🎵', '☕']

function shuffle<T>(arr: T[]) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

type Msg = { type: 'flip'; who: string; index: number }

export default function FlipPage() {
  const who = getWho()!
  const deck = useMemo(() => shuffle([...EMOJIS, ...EMOJIS]), [])
  const [open, setOpen] = useState<number[]>([])
  const [matched, setMatched] = useState<number[]>([])
  const [pending, setPending] = useState<number | null>(null)
  const room = useCoupleRoom({
    onData: (raw) => {
      const msg = raw as Msg
      if (msg?.type === 'flip' && msg.who !== who) applyFlip(msg.index, false)
    },
  })

  function applyFlip(index: number, broadcast: boolean) {
    if (matched.includes(index) || open.includes(index)) return
    if (broadcast) room.sendReliable({ type: 'flip', who, index })
    if (pending == null) {
      setPending(index)
      setOpen([index])
      return
    }
    const a = pending
    const b = index
    setOpen([a, b])
    if (deck[a] === deck[b]) {
      setMatched((m) => [...m, a, b])
      setPending(null)
      setOpen([])
    } else {
      setTimeout(() => {
        setOpen([])
        setPending(null)
      }, 600)
    }
  }

  return (
    <View className='bu-page'>
      <Text className='bu-title'>翻翻乐</Text>
      <Text className='bu-sub'>{whoLabel(who)} · 一起配对</Text>
      <View style={{ display: 'flex', flexWrap: 'wrap', gap: '12rpx' }}>
        {deck.map((face, i) => {
          const show = matched.includes(i) || open.includes(i)
          return (
            <View
              key={i}
              onClick={() => applyFlip(i, true)}
              style={{
                width: '150rpx',
                height: '150rpx',
                borderRadius: '16rpx',
                background: show ? '#f7faf7' : '#3d6b5a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '48rpx',
              }}
            >
              <Text>{show ? face : '?'}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}
