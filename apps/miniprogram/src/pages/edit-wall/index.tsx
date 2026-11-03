import { useEffect, useState } from 'react'
import { View, Text, Input, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { loadNotes } from '../../lib/content'
import { saveWallNotes, uploadWallPhoto } from '../../lib/cloudApi'
import { getWho } from '../../lib/identity'
import type { StickyNote } from '../../lib/types'
import './index.scss'

export default function EditWallPage() {
  const [notes, setNotes] = useState<StickyNote[]>([])
  const [text, setText] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadNotes().then(setNotes)
  }, [])

  async function persist(next: StickyNote[]) {
    setNotes(next)
    const ok = await saveWallNotes(next)
    Taro.showToast({
      title: ok ? '已同步云端' : '已改本地（未开云开发则仅本次有效）',
      icon: 'none',
    })
  }

  async function addText() {
    if (!text.trim()) return
    const who = getWho() || 'her'
    const note: StickyNote = {
      id: `n-${Date.now()}`,
      kind: 'text',
      text: text.trim(),
      detail: detail.trim(),
      about: who,
      src: '',
      x: 20 + Math.random() * 60,
      y: 15 + Math.random() * 60,
      rotate: Math.floor(Math.random() * 10) - 5,
      tone: 'butter',
    }
    setText('')
    setDetail('')
    await persist([note, ...notes])
  }

  async function addPhoto() {
    const who = getWho() || 'her'
    const pick = await Taro.chooseImage({ count: 1, sizeType: ['compressed'] })
    const path = pick.tempFilePaths[0]
    setBusy(true)
    try {
      const fileId = await uploadWallPhoto(path)
      const note: StickyNote = {
        id: `p-${Date.now()}`,
        kind: 'photo',
        text: '照片',
        detail: detail.trim(),
        about: who,
        src: fileId || path,
        x: 20 + Math.random() * 60,
        y: 15 + Math.random() * 60,
        rotate: Math.floor(Math.random() * 8) - 4,
        tone: 'cream',
      }
      await persist([note, ...notes])
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    await persist(notes.filter((n) => n.id !== id))
  }

  return (
    <View className='bu-page'>
      <Text className='bu-title'>编辑墙</Text>
      <Text className='bu-sub'>仅情侣绑定账号可写；需开通云开发后才会持久化。</Text>
      <View className='bu-card'>
        <Input placeholder='标题' value={text} onInput={(e) => setText(e.detail.value)} />
        <Textarea
          placeholder='详情（可选）'
          value={detail}
          onInput={(e) => setDetail(e.detail.value)}
          style={{ marginTop: '12rpx', width: '100%' }}
        />
        <View className='bu-btn' style={{ marginTop: '16rpx' }} onClick={() => void addText()}>
          钉文字
        </View>
        <View
          className='bu-btn bu-btn-ghost'
          style={{ marginTop: '12rpx' }}
          onClick={() => !busy && void addPhoto()}
        >
          {busy ? '上传中…' : '钉照片'}
        </View>
      </View>
      {notes.slice(0, 40).map((n) => (
        <View key={n.id} className='bu-card'>
          <Text>
            [{n.kind}] {n.text}
          </Text>
          <View className='bu-btn bu-btn-danger' style={{ marginTop: '12rpx' }} onClick={() => void remove(n.id)}>
            删除
          </View>
        </View>
      ))}
    </View>
  )
}
