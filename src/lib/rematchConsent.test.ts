import { describe, expect, it, vi } from 'vitest'
import {
  createRematchConsentCore,
  isLegacyRematchWire,
  isRematchWire,
} from './rematchConsent'

describe('isRematchWire', () => {
  it('recognizes ask/ok/no', () => {
    expect(isRematchWire({ type: 'restart-ask', seq: 1 })).toBe(true)
    expect(isRematchWire({ type: 'restart-ok', seq: 1 })).toBe(true)
    expect(isRematchWire({ type: 'restart-no', seq: 1 })).toBe(true)
    expect(isRematchWire({ type: 'hello' })).toBe(false)
    expect(isRematchWire(null)).toBe(false)
  })
})

describe('isLegacyRematchWire', () => {
  it('recognizes rematch/again', () => {
    expect(isLegacyRematchWire({ type: 'rematch', seq: 2 })).toBe(true)
    expect(isLegacyRematchWire({ type: 'again' })).toBe(true)
    expect(isLegacyRematchWire({ type: 'restart-ask', seq: 1 })).toBe(false)
  })
})

describe('createRematchConsentCore', () => {
  it('ask → peer ok → agreed once; retry ok ignored', () => {
    const sent: unknown[] = []
    const onAgreed = vi.fn()
    const core = createRematchConsentCore({
      send: (m) => sent.push(m),
      onAgreed,
    })

    expect(core.askRestart()).toBe(true)
    expect(core.getAsk()).toBe('waiting')
    expect(sent).toEqual([{ type: 'restart-ask', seq: 1 }])

    expect(core.handleWire({ type: 'restart-ok', seq: 1 })).toBe('agreed')
    expect(onAgreed).toHaveBeenCalledTimes(1)
    expect(core.getAsk()).toBe(null)

    expect(core.handleWire({ type: 'restart-ok', seq: 1 })).toBe('ignored')
    expect(onAgreed).toHaveBeenCalledTimes(1)
  })

  it('ask → reject clears waiting', () => {
    const core = createRematchConsentCore({
      send: () => {},
      onAgreed: () => {},
    })
    core.askRestart()
    expect(core.handleWire({ type: 'restart-no', seq: 1 })).toBe('rejected')
    expect(core.getAsk()).toBe(null)
  })

  it('incoming ask while waiting auto-agrees', () => {
    const sent: unknown[] = []
    const onAgreed = vi.fn()
    const core = createRematchConsentCore({
      send: (m) => sent.push(m),
      onAgreed,
    })
    core.askRestart()
    expect(core.handleWire({ type: 'restart-ask', seq: 2 })).toBe('agreed')
    expect(sent.at(-1)).toEqual({ type: 'restart-ok', seq: 2 })
    expect(onAgreed).toHaveBeenCalledTimes(1)
  })

  it('incoming ask when idle goes to decide; accept applies', () => {
    const sent: unknown[] = []
    const onAgreed = vi.fn()
    const core = createRematchConsentCore({
      send: (m) => sent.push(m),
      onAgreed,
    })
    expect(core.handleWire({ type: 'restart-ask', seq: 1 })).toBe('decide')
    expect(core.getAsk()).toBe('decide')
    expect(core.accept()).toBe(true)
    expect(sent.at(-1)).toEqual({ type: 'restart-ok', seq: 1 })
    expect(onAgreed).toHaveBeenCalledTimes(1)
  })

  it('stale ask seq ignored; isCurrentRoundSeq after rematch', () => {
    const core = createRematchConsentCore({
      send: () => {},
      onAgreed: () => {},
    })
    core.askRestart()
    expect(core.handleWire({ type: 'restart-ask', seq: 1 })).toBe('ignored')
    core.handleWire({ type: 'restart-ok', seq: 1 })
    expect(core.isCurrentRoundSeq(1)).toBe(true)
    expect(core.isCurrentRoundSeq(undefined)).toBe(false)
    expect(core.isCurrentRoundSeq(0)).toBe(false)
  })

  it('blocks ask when disconnected', () => {
    const core = createRematchConsentCore({
      send: () => {},
      onAgreed: () => {},
      isConnected: () => false,
    })
    expect(core.askRestart()).toBe(false)
    expect(core.getAsk()).toBe(null)
  })
})
