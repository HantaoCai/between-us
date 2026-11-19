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
  const askRef = useRef<RematchAsk>(null)
  const seqRef = useRef(0)
  const appliedSeqRef = useRef(0)

  const sendRef = useRef(opts.sendReliable)
  sendRef.current = opts.sendReliable
  const onAgreedRef = useRef(opts.onAgreed)
  onAgreedRef.current = opts.onAgreed
  const isSpectatorRef = useRef(opts.isSpectator)
  isSpectatorRef.current = opts.isSpectator
  const isConnectedRef = useRef(opts.isConnected)
  isConnectedRef.current = opts.isConnected

  const setAskBoth = useCallback((next: RematchAsk) => {
    askRef.current = next
    setAsk(next)
  }, [])

  const applyAgreed = useCallback(() => {
    appliedSeqRef.current = seqRef.current
    setAskBoth(null)
    onAgreedRef.current()
  }, [setAskBoth])

  const getSeq = useCallback(() => seqRef.current, [])

  /** 旧局就绪包：seq 对不上就丢（缺 seq 且已重开过也丢） */
  const isCurrentRoundSeq = useCallback((seq: unknown) => {
    if (typeof seq === 'number' && Number.isInteger(seq)) {
      return seq === seqRef.current
    }
    return seqRef.current === 0
  }, [])

  const clearAsk = useCallback(() => {
    setAskBoth(null)
  }, [setAskBoth])

  /** 申请再来；未连上返回 false */
  const askRestart = useCallback((): boolean => {
    if (isSpectatorRef.current?.()) return false
    if (askRef.current) return false
    if (isConnectedRef.current && !isConnectedRef.current()) return false
    const seq = seqRef.current + 1
    seqRef.current = seq
    setAskBoth('waiting')
    sendRef.current({ type: 'restart-ask', seq })
    return true
  }, [setAskBoth])

  const accept = useCallback((): boolean => {
    if (askRef.current !== 'decide') return false
    const seq = seqRef.current
    sendRef.current({ type: 'restart-ok', seq })
    applyAgreed()
    return true
  }, [applyAgreed])

  const reject = useCallback((): boolean => {
    if (askRef.current !== 'decide') return false
    sendRef.current({ type: 'restart-no', seq: seqRef.current })
    setAskBoth(null)
    return true
  }, [setAskBoth])

  const handleWire = useCallback(
    (raw: unknown): RematchHandleKind => {
      if (!isRematchWire(raw)) return 'ignored'
      const spectating = !!isSpectatorRef.current?.()

      if (raw.type === 'restart-ask') {
        if (!Number.isInteger(raw.seq) || raw.seq <= seqRef.current) return 'ignored'
        seqRef.current = raw.seq
        if (spectating) return 'spectator-ask'
        // 双方几乎同时点申请：后到的当成同意
        if (askRef.current === 'waiting') {
          sendRef.current({ type: 'restart-ok', seq: raw.seq })
          applyAgreed()
          return 'agreed'
        }
        setAskBoth('decide')
        return 'decide'
      }

      if (raw.type === 'restart-ok') {
        if (!Number.isInteger(raw.seq) || raw.seq !== seqRef.current) return 'ignored'
        if (spectating) return 'spectator-ok'
        if (raw.seq <= appliedSeqRef.current) return 'ignored'
        applyAgreed()
        return 'agreed'
      }

      // restart-no
      if (!Number.isInteger(raw.seq) || raw.seq !== seqRef.current) return 'ignored'
      if (askRef.current !== 'waiting') return 'ignored'
      setAskBoth(null)
      return 'rejected'
    },
    [applyAgreed, setAskBoth],
  )

  /** 旧版 rematch/again：抬 seq 并本地开新局 */
  const handleLegacyRematch = useCallback(
    (raw: unknown): RematchHandleKind => {
      if (!isLegacyRematchWire(raw)) return 'ignored'
      const seq =
        typeof raw.seq === 'number' && Number.isInteger(raw.seq) ? raw.seq : seqRef.current + 1
      if (seq <= appliedSeqRef.current) return 'ignored'
      if (seq > seqRef.current) seqRef.current = seq
      if (isSpectatorRef.current?.()) return 'spectator-ok'
      applyAgreed()
      return 'agreed'
    },
    [applyAgreed],
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
    /** 人机/测试：强制记已落地序号 */
    markApplied: () => {
      appliedSeqRef.current = seqRef.current
    },
  }
}

export type RematchConsentApi = ReturnType<typeof useRematchConsent>
