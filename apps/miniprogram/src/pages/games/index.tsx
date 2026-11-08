import { useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { AppNav } from '../../components/AppNav'
import { COUPLE_ROOM_CODE, CLOUD_ENV_ID } from '../../config/couple'
import { getWho, whoLabel } from '../../lib/identity'
import { CoupleRoom } from '../../lib/room'
import './index.scss'

const GAMES = [
  { id: 'dice', title: '掷骰子', tag: '合作', path: '/pages/games/dice/index' },
  { id: 'reaction', title: '反应力', tag: '竞技', path: '/pages/games/reaction/index' },
  { id: 'quiz', title: '默契问答', tag: '升温', path: '/pages/games/quiz/index' },
  { id: 'guess', title: '猜数字', tag: '脑力', path: '/pages/games/guess/index' },
  { id: 'flip', title: '翻翻乐', tag: '对抗', path: '/pages/games/flip/index' },
  { id: 'chemistry', title: '化学反应', tag: '升温', path: '/pages/games/chemistry/index' },
  { id: 'gomoku', title: '五子棋', tag: '棋牌', path: '/pages/games/gomoku/index' },
  { id: 'poker', title: '双人德州', tag: '棋牌', path: '/pages/games/poker/index' },
  { id: 'draw', title: '你画我猜', tag: '合作', path: '/pages/games/draw/index' },
]

export default function GamesHubPage() {
  const [peer, setPeer] = useState(false)
  const [status, setStatus] = useState('连接专属房…')
  const who = getWho()

  useEffect(() => {
    let room: CoupleRoom | null = null
    let dead = false
    void (async () => {
      try {
        room = new CoupleRoom({
          onData: () => {},
          onOpen: () => {
            if (dead) return
            setStatus(
              CLOUD_ENV_ID
                ? `已进房 ${COUPLE_ROOM_CODE}`
                : `本地模式 · 房号 ${COUPLE_ROOM_CODE}`,
            )
          },
          onPeer: (present) => {
            if (!dead) setPeer(present)
          },
          onError: (msg) => {
            if (!dead) setStatus(msg)
          },
        })
        await room.connect()
      } catch (err) {
        if (!dead) setStatus(err instanceof Error ? err.message : '进房失败')
      }
    })()
    return () => {
      dead = true
      room?.destroy()
    }
  }, [])

  return (
    <View className='bu-page games-hub'>
      <AppNav active='小游戏' />
      <Text className='bu-sub'>固定情侣房 · 不用再发链接</Text>
      <Text className='bu-title'>小游戏</Text>
      <View className='bu-card'>
        <Text>你是 {whoLabel(who)}</Text>
        <Text className='bu-sub'>{status}</Text>
        <Text className='bu-sub'>{peer ? '对方在线' : '等待对方打开小程序…'}</Text>
      </View>
      <View className='game-grid'>
        {GAMES.map((g) => (
          <View
            key={g.id}
            className='game-tile'
            onClick={() => Taro.navigateTo({ url: g.path })}
          >
            <Text className='bu-chip'>{g.tag}</Text>
            <Text className='game-title'>{g.title}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
