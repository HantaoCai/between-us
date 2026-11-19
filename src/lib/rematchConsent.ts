import { useCallback, useRef, useState } from 'react'

/** 再来一局申请态：空 | 已申请等对方 | 对方申请待决 */
export type RematchAsk = null | 'waiting' | 'decide'

export type RematchWire =
  | { type: 'restart-ask'; seq: number }
  | { type: 'restart-ok'; seq: number }
  | { type: 'restart-no'; seq: number }

export function isRematchWire(raw: unknown): raw is RematchWire {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) return false
  const t = (raw as { type: string }).type
  return t === 'restart-ask' || t === 'restart-ok' || t === 'restart-no'
}

/** 旧版单方再来包：收到后当作对方已同意 */
export function isLegacyRematchWire(raw: unknown): raw is {
  type: 'rematch' | 'again'
  seq?: number
} {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) return false
  const t = (raw as { type: string }).type
  return t === 'rematch' || t === 'again'
}

export type RematchHandleKind =
  | 'ignored'
  | 'decide'
  | 'rejected'
  | 'agreed'
  | 'spectator-ask'
  | 'spectator-ok'

/**
 * 无 React 依赖的再来协议状态机（可单测）。
 * onAgreed 是唯一由游戏实现的「开新局」。
 */
export function createRematchConsentCore(opts: {
  send: (msg: RematchWire) => void
  onAgreed: () => void
  isSpectator?: () => boolean
  isConnected?: () => boolean
  onAskChange?: (ask: RematchAsk) => void
}) {
  let ask: RematchAsk = null
  let seq = 0
  let appliedSeq = 0

  function setAsk(next: RematchAsk) {
    ask = next
    opts.onAskChange?.(next)
  }

  function applyAgreed() {
    appliedSeq = seq
    setAsk(null)
    opts.onAgreed()
  }

  function getSeq() {
    return seq
  }

  function getAsk() {
    return ask
  }

  /** 旧局就绪包：seq 对不上就丢（缺 seq 且已重开过也丢） */
  function isCurrentRoundSeq(roundSeq: unknown) {
    if (typeof roundSeq === 'number' && Number.isInteger(roundSeq)) {
      return roundSeq === seq
    }
    return seq === 0
  }

  function clearAsk() {
    setAsk(null)
  }

  function askRestart(): boolean {
    if (opts.isSpectator?.()) return false
    if (ask) return false
    if (opts.isConnected && !opts.isConnected()) return false
    seq += 1
    setAsk('waiting')
    opts.send({ type: 'restart-ask', seq })
    return true
  }

  function accept(): boolean {
    if (ask !== 'decide') return false
    opts.send({ type: 'restart-ok', seq })
    applyAgreed()
    return true
  }

  function reject(): boolean {
    if (ask !== 'decide') return false
    opts.send({ type: 'restart-no', seq })
    setAsk(null)
    return true
  }

  function handleWire(raw: unknown): RematchHandleKind {
    if (!isRematchWire(raw)) return 'ignored'
    const spectating = !!opts.isSpectator?.()

    if (raw.type === 'restart-ask') {
      if (!Number.isInteger(raw.seq) || raw.seq <= seq) return 'ignored'
      seq = raw.seq
      if (spectating) return 'spectator-ask'
      if (ask === 'waiting') {
        opts.send({ type: 'restart-ok', seq: raw.seq })
        applyAgreed()
        return 'agreed'
      }
      setAsk('decide')
      return 'decide'
    }

    if (raw.type === 'restart-ok') {
      if (!Number.isInteger(raw.seq) || raw.seq !== seq) return 'ignored'
      if (spectating) return 'spectator-ok'
      if (raw.seq <= appliedSeq) return 'ignored'
      applyAgreed()
      return 'agreed'
    }

    if (!Number.isInteger(raw.seq) || raw.seq !== seq) return 'ignored'
    if (ask !== 'waiting') return 'ignored'
    setAsk(null)
    return 'rejected'
  }

  function handleLegacyRematch(raw: unknown): RematchHandleKind {
    if (!isLegacyRematchWire(raw)) return 'ignored'
    const next =
      typeof raw.seq === 'number' && Number.isInteger(raw.seq) ? raw.seq : seq + 1
    if (next <= appliedSeq) return 'ignored'
    if (next > seq) seq = next
    if (opts.isSpectator?.()) return 'spectator-ok'
    applyAgreed()
    return 'agreed'
  }

  function markApplied() {
    appliedSeq = seq
  }

  return {
    getAsk,
    getSeq,
    isCurrentRoundSeq,
    askRestart,
    accept,
    reject,
    clearAsk,
    handleWire,
    handleLegacyRematch,
    markApplied,
  }
}

export type RematchConsentCore = ReturnType<typeof createRematchConsentCore>

/**
 * 双方同意再来一局：各游戏共用一套协议。
 * onAgreed 是唯一由游戏实现的「开新局」。
 */
export function useRematchConsent(opts: {
  sendReliable: (msg: RematchWire) => void
  onAgreed: () => void
  isSpectator?: () => boolean
  isConnected?: () => boolean
}) {
  const [ask, setAsk] = useState<RematchAsk>(null)

  const sendRef = useRef(opts.sendReliable)
  sendRef.current = opts.sendReliable
  const onAgreedRef = useRef(opts.onAgreed)
  onAgreedRef.current = opts.onAgreed
  const isSpectatorRef = useRef(opts.isSpectator)
  isSpectatorRef.current = opts.isSpectator
  const isConnectedRef = useRef(opts.isConnected)
  isConnectedRef.current = opts.isConnected

  const coreRef = useRef<RematchConsentCore | null>(null)
  if (!coreRef.current) {
    coreRef.current = createRematchConsentCore({
      send: (msg) => sendRef.current(msg),
      onAgreed: () => onAgreedRef.current(),
      isSpectator: () => !!isSpectatorRef.current?.(),
      isConnected: () =>
        isConnectedRef.current ? isConnectedRef.current() : true,
      onAskChange: setAsk,
    })
  }
  const core = coreRef.current

  const askRestart = useCallback(() => core.askRestart(), [core])
  const accept = useCallback(() => core.accept(), [core])
  const reject = useCallback(() => core.reject(), [core])
  const clearAsk = useCallback(() => core.clearAsk(), [core])
  const handleWire = useCallback((raw: unknown) => core.handleWire(raw), [core])
  const handleLegacyRematch = useCallback(
    (raw: unknown) => core.handleLegacyRematch(raw),
    [core],
  )
  const getSeq = useCallback(() => core.getSeq(), [core])
  const isCurrentRoundSeq = useCallback(
    (seq: unknown) => core.isCurrentRoundSeq(seq),
    [core],
  )

  return {
    ask,
    getSeq,
    isCurrentRoundSeq,
    askRestart,
    accept,
    reject,
    clearAsk,
    handleWire,
    handleLegacyRematch,
    markApplied: () => core.markApplied(),
  }
}

export type RematchConsentApi = ReturnType<typeof useRematchConsent>
