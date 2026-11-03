import { useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import { getWho, whoLabel, otherWho } from '../../../lib/identity'
import { useCoupleRoom } from '../../../lib/useCoupleRoom'

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = ['♠', '♥', '♦', '♣']

function freshDeck() {
  const d: string[] = []
  for (const s of SUITS) for (const r of RANKS) d.push(r + s)
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

type Msg =
  | { type: 'deal'; deck: string[]; button: string }
  | { type: 'fold'; who: string }
  | { type: 'call'; who: string }

export default function PokerPage() {
  const who = getWho()!
  const [deck, setDeck] = useState<string[]>([])
  const [board, setBoard] = useState<string[]>([])
  const [holes, setHoles] = useState<Record<string, string[]>>({ her: [], me: [] })
  const [pot, setPot] = useState(30)
  const [stacks, setStacks] = useState({ her: 1000, me: 1000 })
  const [folded, setFolded] = useState<string | null>(null)
  const [show, setShow] = useState(false)
  const room = useCoupleRoom({
    onData: (raw) => {
      const msg = raw as Msg
      if (msg?.type === 'deal') applyDeal(msg.deck, msg.button, false)
      if (msg?.type === 'fold') onFold(msg.who, false)
      if (msg?.type === 'call') onCall(msg.who, false)
    },
  })

  const myHole = holes[who] || []
  const peerHole = holes[otherWho(who)] || []

  function applyDeal(d: string[], _button: string, broadcast: boolean) {
    const next = d.slice()
    const her = [next.pop()!, next.pop()!]
    const me = [next.pop()!, next.pop()!]
    setDeck(next)
    setHoles({ her, me })
    setBoard([])
    setPot(30)
    setFolded(null)
    setShow(false)
    setStacks({ her: 990, me: 980 })
    if (broadcast) room.sendReliable({ type: 'deal', deck: d, button: who })
  }

  function deal() {
    applyDeal(freshDeck(), who, true)
  }

  function fillRiver(currentDeck: string[], currentBoard: string[]) {
    const d = currentDeck.slice()
    const b = currentBoard.slice()
    if (b.length === 0) b.push(d.pop()!, d.pop()!, d.pop()!)
    while (b.length < 5) b.push(d.pop()!)
    return { d, b }
  }

  function onFold(folder: string, broadcast: boolean) {
    if (broadcast) room.sendReliable({ type: 'fold', who: folder })
    const winner = folder === 'her' ? 'me' : 'her'
    setStacks((s) => ({ ...s, [winner]: s[winner as 'her' | 'me'] + pot }))
    setPot(0)
    setFolded(folder)
    setShow(true)
    setDeck((d) => {
      setBoard((b) => {
        const filled = fillRiver(d, b)
        setTimeout(() => setDeck(filled.d), 0)
        return filled.b
      })
      return d
    })
  }

  function onCall(actor: string, broadcast: boolean) {
    if (broadcast) room.sendReliable({ type: 'call', who: actor })
    setPot((p) => p + 20)
    setStacks((s) => ({ ...s, [actor]: s[actor as 'her' | 'me'] - 20 }))
    setDeck((d) => {
      const next = d.slice()
      setBoard((b) => {
        if (b.length >= 5) {
          setShow(true)
          return b
        }
        if (b.length === 0) return [next.pop()!, next.pop()!, next.pop()!]
        return [...b, next.pop()!]
      })
      setTimeout(() => setDeck(next), 0)
      return d
    })
  }

  const result = useMemo(() => {
    if (!folded) return ''
    return `${whoLabel(folded === 'her' ? 'me' : 'her')} 赢（对手弃牌）`
  }, [folded])

  return (
    <View className='bu-page'>
      <Text className='bu-title'>双人德州</Text>
      <Text className='bu-sub'>
        {whoLabel(who)} · 底池 {pot} · 我 {stacks[who]} / 对方 {stacks[otherWho(who)]}
      </Text>
      <View className='bu-card'>
        <Text>公共牌：{board.join(' ') || '等待'}</Text>
        <Text>我的底牌：{myHole.join(' ') || '-'}</Text>
        <Text>对方：{show ? peerHole.join(' ') : '??'}</Text>
        {result ? <Text>{result}</Text> : null}
      </View>
      <View className='bu-btn' onClick={deal}>
        发一手
      </View>
      <View className='bu-row' style={{ marginTop: '16rpx' }}>
        <View className='bu-btn bu-btn-danger' style={{ flex: 1 }} onClick={() => onFold(who, true)}>
          弃牌（发完河牌并亮）
        </View>
        <View className='bu-btn' style={{ flex: 1 }} onClick={() => onCall(who, true)}>
          跟注/过牌
        </View>
      </View>
    </View>
  )
}
