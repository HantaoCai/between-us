import { useEffect, useState } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { AppNav } from '../../components/AppNav'
import { daysTogether, getSite, loadNotes } from '../../lib/content'
import { whoLabel, getWho } from '../../lib/identity'
import type { StickyNote } from '../../lib/types'
import './index.scss'

const TONE_BG: Record<string, string> = {
  butter: '#f6e7b8',
  mint: '#d8efe4',
  sky: '#d7e8f7',
  peach: '#f7dccb',
  rose: '#f3d0d8',
  cream: '#f4efe4',
}

export default function HomePage() {
  const [notes, setNotes] = useState<StickyNote[]>([])
  const site = getSite()
  const days = daysTogether()

  useEffect(() => {
    void loadNotes().then(setNotes)
  }, [])

  function openNote(n: StickyNote) {
    if (n.kind === 'photo' && n.src) {
      Taro.previewImage({ urls: [n.src], current: n.src })
      return
    }
    Taro.showModal({
      title: n.text,
      content: n.detail || whoLabel(n.about),
      showCancel: false,
    })
  }

  return (
    <View className='bu-page home'>
      <AppNav active='拾光' />
      <View className='home-hero'>
        <Text className='bu-sub'>BETWEEN US · {whoLabel(getWho())}</Text>
        <Text className='bu-title'>{site.togetherLabel} {days} 天</Text>
        <Text className='bu-sub'>自 {site.togetherSince}</Text>
      </View>

      <View className='wall'>
        {notes.map((n) => (
          <View
            key={n.id}
            className={`pin pin-${n.kind}`}
            style={{
              left: `${n.x}%`,
              top: `${n.y}%`,
              transform: `translate(-50%, -50%) rotate(${n.rotate}deg)`,
              background: n.kind === 'photo' ? '#fff' : TONE_BG[n.tone] || TONE_BG.butter,
            }}
            onClick={() => openNote(n)}
          >
            {n.kind === 'photo' && n.src ? (
              <Image className='pin-img' src={n.src} mode='aspectFill' />
            ) : (
              <Text className='pin-text'>{n.text}</Text>
            )}
          </View>
        ))}
      </View>

      <View className='home-actions'>
        <View className='bu-btn' onClick={() => Taro.navigateTo({ url: '/pages/edit-wall/index' })}>
          编辑墙 / 钉照片
        </View>
        <View
          className='bu-btn bu-btn-ghost'
          style={{ marginTop: '16rpx' }}
          onClick={() => Taro.navigateTo({ url: '/pages/impressions/index' })}
        >
          看印象
        </View>
      </View>
    </View>
  )
}
