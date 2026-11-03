import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { kindLabel } from '../lib/content'
import type { Memory } from '../lib/types'

export function MemoryList({
  title,
  subtitle,
  items,
}: {
  title: string
  subtitle?: string
  items: Memory[]
}) {
  return (
    <View className='bu-page'>
      <Text className='bu-title'>{title}</Text>
      {subtitle ? <Text className='bu-sub'>{subtitle}</Text> : null}
      {items.length === 0 ? (
        <Text className='bu-sub'>还没有内容</Text>
      ) : (
        items.map((m) => (
          <View
            key={m.slug}
            className='bu-card'
            onClick={() =>
              Taro.navigateTo({
                url: `/pages/memory/index?slug=${encodeURIComponent(m.slug)}`,
              })
            }
          >
            <View className='bu-chip'>{kindLabel(m.kind)}</View>
            <Text className='mem-title'>{m.title}</Text>
            <Text className='bu-sub'>
              {m.date}
              {m.place ? ` · ${m.place}` : ''}
            </Text>
          </View>
        ))
      )}
    </View>
  )
}
