import { useEffect, useState } from 'react'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { MemoryList } from '../../components/MemoryList'
import { filterMemories, loadMemories } from '../../lib/content'
import type { Memory } from '../../lib/types'
import '../milestones/index.scss'

export default function ArchivePage() {
  const [items, setItems] = useState<Memory[]>([])
  useEffect(() => {
    void loadMemories().then((all) => setItems(filterMemories(all, 'event')))
  }, [])
  return (
    <View>
      <MemoryList title='归档' subtitle='琐碎日常也留下来' items={items} />
      <View
        className='bu-page'
        style={{ paddingTop: 0 }}
        onClick={() => Taro.navigateTo({ url: '/pages/places/index' })}
      >
        <View className='bu-btn bu-btn-ghost'>去看「地方」</View>
      </View>
    </View>
  )
}
