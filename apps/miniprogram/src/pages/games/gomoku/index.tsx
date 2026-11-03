import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getWho, whoLabel } from '../../../lib/identity'
import { useCoupleRoom } from '../../../lib/useCoupleRoom'

const N = 15
type Cell = '' | 'B' | 'W'
type Msg = { type: 'place'; who: string; r: number; c: number }

function emptyBoard(): Cell[] {
  return Array(N * N).fill('')
}

function win(board: Cell[], r: number, c: number, stone: Cell) {
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ]
  for (const [dr, dc] of dirs) {
    let n = 1
    for (const sign of [1, -1]) {
      let rr = r + dr * sign
      let cc = c + dc * sign
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] === stone) {
        n++
        rr += dr * sign
        cc += dc * sign
      }
    }
    if (n >= 5) return true
  }
  return false
}

export default function GomokuPage() {
  const who = getWho()!
  const myStone: Cell = who === 'her' ? 'B' : 'W'
  const [board, setBoard] = useState<Cell[]>(emptyBoard)
  const [turn, setTurn] = useState<Cell>('B')
  const room = useCoupleRoom({
    onData: (raw) => {
      const msg = raw as Msg
      if (msg?.type !== 'place' || msg.who === who) return
      place(msg.r, msg.c, false)
    },
  })

  function place(r: number, c: number, broadcast: boolean) {
    setBoard((prev) => {
      const i = r * N + c
      if (prev[i]) return prev
      const stone = turn
      if (broadcast && stone !== myStone) return prev
      const next = prev.slice()
      next[i] = stone
      if (broadcast) room.sendReliable({ type: 'place', who, r, c })
      if (win(next, r, c, stone)) {
        Taro.showToast({ title: `${stone === 'B' ? '黑' : '白'}胜`, icon: 'none' })
      }
      setTurn(stone === 'B' ? 'W' : 'B')
      return next
    })
  }

  return (
    <View className='bu-page'>
      <Text className='bu-title'>五子棋</Text>
      <Text className='bu-sub'>
        {whoLabel(who)} · 你是{myStone === 'B' ? '黑' : '白'} · 轮到{turn === 'B' ? '黑' : '白'}
      </Text>
      <View style={{ display: 'flex', flexWrap: 'wrap', width: '690rpx' }}>
        {board.map((cell, i) => {
          const r = Math.floor(i / N)
          const c = i % N
          return (
            <View
              key={i}
              onClick={() => place(r, c, true)}
              style={{
                width: '46rpx',
                height: '46rpx',
                boxSizing: 'border-box',
                border: '1rpx solid #cbbfae',
                background: '#e7d7b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28rpx',
              }}
            >
              <Text>{cell === 'B' ? '●' : cell === 'W' ? '○' : ''}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}
