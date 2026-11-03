import { View, Text, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { ABOUT_LABEL, type NoteAbout } from '../../config/couple'
import { bindCoupleIdentity } from '../../lib/cloudApi'
import { setWho } from '../../lib/identity'
import './index.scss'

export default function OnboardingPage() {
  async function choose(who: NoteAbout) {
    setWho(who)
    await bindCoupleIdentity(who)
    Taro.showToast({ title: `你好，${ABOUT_LABEL[who]}`, icon: 'none' })
    setTimeout(() => {
      Taro.reLaunch({ url: '/pages/home/index' })
    }, 400)
  }

  return (
    <View className='bu-page onboarding'>
      <Text className='bu-sub'>BETWEEN US</Text>
      <Text className='bu-title'>你是谁</Text>
      <Text className='bu-sub'>选一次就好</Text>
      <Button className='bu-btn' onClick={() => void choose('her')}>
        我是{ABOUT_LABEL.her}
      </Button>
      <Button className='bu-btn bu-btn-ghost' style={{ marginTop: '20rpx' }} onClick={() => void choose('me')}>
        我是{ABOUT_LABEL.me}
      </Button>
    </View>
  )
}
