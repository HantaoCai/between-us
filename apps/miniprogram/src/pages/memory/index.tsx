import { useEffect, useState } from 'react'
import { View, Text, Image } from '@tarojs/components'
import { useRouter } from '@tarojs/taro'
import { kindLabel, loadMemories } from '../../lib/content'
import type { Memory } from '../../lib/types'
import './index.scss'

export default function MemoryDetailPage() {
  const router = useRouter()
  const slug = decodeURIComponent(router.params.slug || '')
  const [mem, setMem] = useState<Memory | null>(null)

  useEffect(() => {
    void loadMemories().then((all) => {
      setMem(all.find((m) => m.slug === slug) || null)
    })
  }, [slug])

  if (!mem) {
    return (
      <View className='bu-page'>
        <Text className='bu-sub'>找不到这条回忆</Text>
      </View>
    )
  }

  return (
    <View className='bu-page memory'>
      <View className='bu-chip'>{kindLabel(mem.kind)}</View>
      <Text className='bu-title'>{mem.title}</Text>
      <Text className='bu-sub'>
        {mem.date}
        {mem.place ? ` · ${mem.place}` : ''}
        {mem.mood ? ` · ${mem.mood}` : ''}
      </Text>
      {mem.cover ? <Image className='cover' src={mem.cover} mode='widthFix' /> : null}
      <Text className='body'>{mem.body}</Text>
      {mem.tags?.length ? (
        <View className='tags'>
          {mem.tags.map((t) => (
            <Text key={t} className='bu-chip'>
              {t}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  )
}
