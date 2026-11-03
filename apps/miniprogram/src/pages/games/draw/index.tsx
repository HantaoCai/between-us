import { useRef, useState } from 'react'
import { View, Text, Canvas, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getWho, whoLabel } from '../../../lib/identity'
import { useCoupleRoom } from '../../../lib/useCoupleRoom'

const WORDS = ['草莓', '小猫', '月亮', '咖啡', '自行车', '雨伞', '吉他', '冰淇淋']

type Msg =
  | { type: 'role'; drawer: string; word: string }
  | { type: 'stroke'; points: Array<{ x: number; y: number }> }
  | { type: 'clear' }
  | { type: 'guess'; who: string; text: string; ok: boolean }

export default function DrawPage() {
  const who = getWho()!
  const [drawer, setDrawer] = useState(who)
  const [word, setWord] = useState(WORDS[0])
  const [guess, setGuess] = useState('')
  const [hint, setHint] = useState('')
  const drawing = useRef(false)
  const points = useRef<Array<{ x: number; y: number }>>([])
  const room = useCoupleRoom({
    onData: (raw) => {
      const msg = raw as Msg
      if (msg?.type === 'role') {
        setDrawer(msg.drawer)
        setWord(msg.word)
      }
      if (msg?.type === 'stroke') paint(msg.points)
      if (msg?.type === 'clear') clearLocal()
      if (msg?.type === 'guess') {
        setHint(msg.ok ? `${whoLabel(msg.who as any)} 猜对了！` : `${whoLabel(msg.who as any)} 猜：${msg.text}`)
      }
    },
  })

  const amDrawer = drawer === who

  function startRound() {
    const w = WORDS[Math.floor(Math.random() * WORDS.length)]
    setDrawer(who)
    setWord(w)
    room.sendReliable({ type: 'role', drawer: who, word: w })
    clearBoard(true)
  }

  function clearLocal() {
    const ctx = Taro.createCanvasContext('draw')
    ctx.setFillStyle('#ffffff')
    ctx.fillRect(0, 0, 340, 340)
    ctx.draw()
  }

  function clearBoard(broadcast: boolean) {
    clearLocal()
    if (broadcast) room.sendReliable({ type: 'clear' })
  }

  function paint(pts: Array<{ x: number; y: number }>) {
    if (pts.length < 2) return
    const ctx = Taro.createCanvasContext('draw')
    ctx.setStrokeStyle('#2a2218')
    ctx.setLineWidth(3)
    ctx.setLineCap('round')
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
    ctx.draw(true)
  }

  function onTouchStart(e: any) {
    if (!amDrawer) return
    drawing.current = true
    const t = e.touches[0]
    points.current = [{ x: t.x, y: t.y }]
  }

  function onTouchMove(e: any) {
    if (!amDrawer || !drawing.current) return
    const t = e.touches[0]
    points.current.push({ x: t.x, y: t.y })
    paint(points.current.slice(-2))
  }

  function onTouchEnd() {
    if (!amDrawer || !drawing.current) return
    drawing.current = false
    room.sendReliable({ type: 'stroke', points: points.current })
    points.current = []
  }

  function submitGuess() {
    const ok = guess.trim() === word
    room.sendReliable({ type: 'guess', who, text: guess.trim(), ok })
    setHint(ok ? '你猜对了！' : '不对，再试试')
  }

  return (
    <View className='bu-page'>
      <Text className='bu-title'>你画我猜</Text>
      <Text className='bu-sub'>
        {whoLabel(who)} · {amDrawer ? `题目：${word}` : '你来猜'}
      </Text>
      <Canvas
        canvasId='draw'
        style={{ width: '680rpx', height: '680rpx', background: '#fff', borderRadius: '16rpx' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />
      <View className='bu-row' style={{ marginTop: '16rpx' }}>
        <View className='bu-btn' style={{ flex: 1 }} onClick={startRound}>
          我来画
        </View>
        <View className='bu-btn bu-btn-ghost' style={{ flex: 1 }} onClick={() => clearBoard(true)}>
          清空
        </View>
      </View>
      {!amDrawer ? (
        <View className='bu-card' style={{ marginTop: '16rpx' }}>
          <Input value={guess} placeholder='输入你的猜测' onInput={(e) => setGuess(e.detail.value)} />
          <View className='bu-btn' style={{ marginTop: '12rpx' }} onClick={submitGuess}>
            提交
          </View>
        </View>
      ) : null}
      {hint ? <Text className='bu-sub'>{hint}</Text> : null}
    </View>
  )
}
