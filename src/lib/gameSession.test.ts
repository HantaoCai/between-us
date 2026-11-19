import { describe, expect, it, vi } from 'vitest'
import {
  requirePeerOpen,
  requirePeerOpenForAsk,
  requirePeerOpenForSync,
} from './gameSession'
import {
  PEER_NOT_CONNECTED_ASK_MSG,
  PEER_NOT_CONNECTED_SYNC_MSG,
} from './peerConfig'

describe('requirePeerOpen', () => {
  it('writes error when closed', () => {
    const setError = vi.fn()
    expect(requirePeerOpen(() => false, setError, '断了')).toBe(false)
    expect(setError).toHaveBeenCalledWith('断了')
  })

  it('clears error when open', () => {
    const setError = vi.fn()
    expect(requirePeerOpen(() => true, setError, '断了')).toBe(true)
    expect(setError).toHaveBeenCalledWith('')
  })

  it('ask/sync helpers use shared copy', () => {
    const setError = vi.fn()
    requirePeerOpenForAsk(() => false, setError)
    expect(setError).toHaveBeenCalledWith(PEER_NOT_CONNECTED_ASK_MSG)
    setError.mockClear()
    requirePeerOpenForSync(() => false, setError)
    expect(setError).toHaveBeenCalledWith(PEER_NOT_CONNECTED_SYNC_MSG)
  })
})
