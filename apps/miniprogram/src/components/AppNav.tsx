import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import './AppNav.scss'

const LINKS = [
  { text: '拾光', url: '/pages/home/index', tab: false },
  { text: '小游戏', url: '/pages/games/index', tab: false },
]

export function AppNav({ active }: { active?: string }) {
  return (
    <View className='app-nav'>
      {LINKS.map((l) => (
        <Text
          key={l.url}
          className={`app-nav-item ${active === l.text ? 'is-active' : ''}`}
          onClick={() => Taro.navigateTo({ url: l.url })}
        >
          {l.text}
        </Text>
      ))}
    </View>
  )
}
