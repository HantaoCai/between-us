import { Peer, type DataConnection } from 'peerjs'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GameShell } from '../components/GameShell'
import { EnterRoomGate } from '../components/EnterRoomGate'
import { RoomBanner } from '../components/PeerLobby'
import {
  countHits,
  formatHits,
  isValidNumber,
  isValidRoomCode,
  normalizeRoomCode,
  randomRoomCode,
  ROOM_PREFIX,
  type DigitLen,
  type GuessResult,
} from '../lib/guessGame'
import { returnToGameHub } from '../lib/hubReturn'
import { aboutLabel, otherAbout, type NoteAbout } from '../lib/notes'
import { PEER_OPTIONS } from '../lib/peerConfig'
import {
  clearPeerRoom,
  patchPeerRoom,
  savePeerRoom,
  useFlushPeerRoomOnLeave,
  type SavedPeerRoom,
} from '../lib/peerRoomSave'
import { useResumePeerRoom } from '../lib/useResumePeerRoom'

type Phase = 'lobby' | 'secret' | 'wait' | 'play' | 'done'

type WireMessage =
  | { type: 'hello'; who: NoteAbout; digits: DigitLen }
  | { type: 'secret-ready' }
  | { type: 'guess'; guess: string; requestId: string }
  | {
      type: 'guess-result'
      requestId: string
      guess: string
      hits: number
    }
  | { type: 'progress'; guesses: GuessResult[] }
  | { type: 'solved'; turns: number }

export function GuessPage() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('lobby')
  const [who, setWho] = useState<NoteAbout>('her')
  const [peerWho, setPeerWho] = useState<NoteAbout | null>(null)
  const [digits, setDigits] = useState<DigitLen>(4)
  const [roomCode, setRoomCode] = useState('')
  const [status, setStatus] = useState('开一间房，或输入对方房间号')
  const [error, setError] = useState('')
  const [secret, setSecret] = useState('')
  const [secretLocked, setSecretLocked] = useState(false)
  const [peerReady, setPeerReady] = useState(false)
  const [draftGuess, setDraftGuess] = useState('')
  const [myGuesses, setMyGuesses] = useState<GuessResult[]>([])
  const [peerGuesses, setPeerGuesses] = useState<GuessResult[]>([])
  const [iSolved, setISolved] = useState(false)
  const [peerSolved, setPeerSolved] = useState(false)
  const [peerTurns, setPeerTurns] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const iSolvedRef = useRef(false)
  const leavingHubRef = useRef(false)

  const peerRef = useRef<Peer | null>(null)
  const connRef = useRef<DataConnection | null>(null)
  const secretRef = useRef('')
  const myGuessesRef = useRef<GuessResult[]>([])
  const whoRef = useRef(who)
  const digitsRef = useRef(digits)
  const secretLockedRef = useRef(false)
  const roomCodeRef = useRef(roomCode)
  const goHubRef = useRef<() => void>(() => {})

  secretRef.current = secret
  myGuessesRef.current = myGuesses
  whoRef.current = who
  digitsRef.current = digits
  secretLockedRef.current = secretLocked
  iSolvedRef.current = iSolved
  roomCodeRef.current = roomCode

  useEffect(() => {
    return () => {
      if (leavingHubRef.current) return
      connRef.current?.close()
      peerRef.current?.destroy()
    }
  }, [])

  useEffect(() => {
    if (secretLocked && peerReady && phase === 'wait') {
      setPhase('play')
      setStatus('开始猜吧，两边可以同时猜')
    }
  }, [secretLocked, peerReady, phase])

  useEffect(() => {
    if (!iSolved || !peerSolved || phase !== 'play') return
    const mine = myGuesses.length
    const theirs = peerTurns ?? peerGuesses.length
    if (mine < theirs) setStatus(`你赢了 · ${mine} 轮 vs ${theirs} 轮`)
    else if (mine > theirs) setStatus(`对方赢了 · ${mine} 轮 vs ${theirs} 轮`)
    else setStatus(`平局 · 都是 ${mine} 轮`)
    setPhase('done')
  }, [iSolved, peerSolved, phase, myGuesses.length, peerGuesses.length, peerTurns])

  useFlushPeerRoomOnLeave(phase !== 'lobby' && !!roomCode, () => {
    if (!roomCode) return null
    const host = !!peerRef.current?.id?.endsWith(roomCode)
    return {
      game: 'guess',
      code: roomCode,
      role: host ? 'host' : 'joiner',
      who: whoRef.current,
      digits: digitsRef.current,
      secret: secretRef.current || undefined,
      secretLocked: secretLockedRef.current,
    }
  })

  const resumeSavedRef = useRef<SavedPeerRoom | null>(null)

  useResumePeerRoom('guess', (saved) => {
    resumeSavedRef.current = saved
    setBusy(true)
    setError('')
    setStatus(`正在回到房间 ${saved.code}…`)
    applySavedIdentity(saved)
    if (saved.role === 'host') void createRoom(saved.code)
    else void joinRoom(saved.code)
  })

  function retryResume() {
    const saved = resumeSavedRef.current
    if (!saved) return
    setBusy(true)
    setError('')
    setStatus(`正在回到房间 ${saved.code}…`)
    applySavedIdentity(saved)
    if (saved.role === 'host') void createRoom(saved.code)
    else void joinRoom(saved.code)
  }

  function applySavedIdentity(saved: SavedPeerRoom) {
    whoRef.current = saved.who
    setWho(saved.who)
    if (saved.digits === 4 || saved.digits === 5) {
      digitsRef.current = saved.digits
      setDigits(saved.digits)
    }
    if (saved.secret) {
      secretRef.current = saved.secret
      setSecret(saved.secret)
    }
    if (saved.secretLocked) {
      secretLockedRef.current = true
      setSecretLocked(true)
    }
  }

  function persistRoom(role: 'host' | 'joiner', code: string) {
    savePeerRoom({
      game: 'guess',
      code,
      role,
      who: whoRef.current,
      digits: digitsRef.current,
      secret: secretRef.current || undefined,
      secretLocked: secretLockedRef.current,
    })
  }

  function send(msg: WireMessage) {
    const conn = connRef.current
    if (!conn?.open) return
    conn.send(msg)
  }

  async function goHub() {
    if (leavingHubRef.current) return
    leavingHubRef.current = true
    const code = roomCodeRef.current
    const role =
      peerRef.current?.id?.endsWith(code) || peerRef.current?.id === `${ROOM_PREFIX}${code}`
        ? 'host'
        : 'joiner'
    const me = whoRef.current
    const peer = peerRef.current
    const conn = connRef.current
    peerRef.current = null
    connRef.current = null
    if (!code) {
      clearPeerRoom('guess')
      navigate('/games', { replace: true })
      return
    }
    setBusy(true)
    setError('')
    setStatus('正在回房间…')
    await returnToGameHub({
      session: peer
        ? {
            isHost: role === 'host',
            destroy() {
              try {
                conn?.close()
              } catch {
                /* ignore */
              }
              try {
                peer.destroy()
              } catch {
                /* ignore */
              }
            },
          }
        : null,
      code,
      role,
      who: me,
      navigate,
    })
  }
  goHubRef.current = () => {
    void goHub()
  }

  function attachConnection(conn: DataConnection, code: string, asHost: boolean) {
    connRef.current = conn
    setRoomCode(code)
    setError('')
    setStatus('已连上，先各自写一个数字')

    conn.on('data', (raw) => {
      const msg = raw as WireMessage
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return

      if (msg.type === 'hello') {
        setPeerWho(msg.who)
        if (!asHost) {
          const mine = otherAbout(msg.who)
          if (whoRef.current !== mine) {
            setWho(mine)
            whoRef.current = mine
          }
          if (msg.digits === 4 || msg.digits === 5) {
            setDigits(msg.digits)
            digitsRef.current = msg.digits
          }
          const reply = {
            type: 'hello' as const,
            who: whoRef.current,
            digits: digitsRef.current,
          }
          send(reply)
          window.setTimeout(() => send(reply), 300)
        }
        return
      }

      if (msg.type === 'secret-ready') {
        setPeerReady(true)
        setStatus(
          secretLockedRef.current
            ? '对方也准备好了'
            : '对方已提交数字，等你提交',
        )
        return
      }

      if (msg.type === 'guess') {
        const hits = countHits(secretRef.current, msg.guess)
        send({
          type: 'guess-result',
          requestId: msg.requestId,
          guess: msg.guess,
          hits,
        })
        return
      }

      if (msg.type === 'guess-result') {
        const next: GuessResult = {
          guess: msg.guess,
          hits: msg.hits,
          at: Date.now(),
        }
        const merged = [...myGuessesRef.current, next]
        myGuessesRef.current = merged
        setMyGuesses(merged)
        send({ type: 'progress', guesses: merged })
        setBusy(false)
        setDraftGuess('')
        if (msg.hits === digitsRef.current) {
          setISolved(true)
          send({ type: 'solved', turns: merged.length })
          setStatus('你猜中了 · 等对方也猜中后比轮次')
        }
        return
      }

      if (msg.type === 'progress') {
        setPeerGuesses(msg.guesses)
        return
      }

      if (msg.type === 'solved') {
        setPeerSolved(true)
        if (typeof msg.turns === 'number' && msg.turns >= 0) {
          setPeerTurns(msg.turns)
        }
        setStatus(
          iSolvedRef.current
            ? '两边都猜中了，正在比轮次…'
            : '对方猜中了 · 等你也猜中后比轮次',
        )
      }
    })

    const onReady = () => {
      const hello = { type: 'hello' as const, who: whoRef.current, digits: digitsRef.current }
      send(hello)
      window.setTimeout(() => send(hello), 300)
      window.setTimeout(() => send(hello), 800)
      if (secretRef.current && secretLockedRef.current) {
        send({ type: 'secret-ready' })
      }
      setPhase((p) => (p === 'lobby' ? 'secret' : p))
      if (asHost) setStatus('对方进来了，先各自写数字')
    }
    conn.on('open', onReady)
    // 房主收到的连接常常已经 open，不会再触发 open
    if (conn.open) onReady()

    conn.on('close', () => {
      setStatus('连接断开了，可返回重新进房')
      setError('对方离开或网络中断')
    })

    conn.on('error', () => {
      setError('连接出错，试试重新开房')
    })
  }

  function waitPeerOpen(peer: Peer, ms = 12000) {
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error('连信令超时，请重试')),
        ms,
      )
      const finish = (fn: () => void) => {
        window.clearTimeout(timer)
        fn()
      }
      peer.on('open', () => finish(() => resolve()))
      peer.on('error', (err) => finish(() => reject(err)))
    })
  }

  function isPeerIdBusy(err: unknown) {
    const type =
      err && typeof err === 'object' && 'type' in err
        ? String((err as { type?: string }).type ?? '')
        : ''
    const msg = err instanceof Error ? err.message : String(err ?? '')
    return (
      type === 'unavailable-id' ||
      /unavailable-id|is taken|already in use/i.test(msg)
    )
  }

  async function createRoom(existingCode?: string) {
    setError('')
    setBusy(true)
    const code =
      existingCode && isValidRoomCode(normalizeRoomCode(existingCode))
        ? normalizeRoomCode(existingCode)
        : randomRoomCode()
    const peerId = `${ROOM_PREFIX}${code}`

    let lastErr: unknown
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) {
          setStatus(`房间号释放中，重试开房（${attempt + 1}/6）…`)
          await new Promise((r) => window.setTimeout(r, 350 * attempt))
        }
        peerRef.current?.destroy()
        connRef.current = null
        const peer = new Peer(peerId, PEER_OPTIONS)
        peerRef.current = peer
        try {
          await waitPeerOpen(peer)
          peer.on('connection', (conn) => {
            if (connRef.current?.open) {
              conn.close()
              return
            }
            attachConnection(conn, code, true)
            setStatus('对方进来了，先各自写数字')
            setPhase(secretLockedRef.current ? 'wait' : 'secret')
          })

          persistRoom('host', code)
          setRoomCode(code)
          setPhase(secretLockedRef.current ? 'wait' : 'secret')
          setStatus(
            secretLockedRef.current
              ? `房间 ${code} · 已恢复，等对方继续加入`
              : `房间 ${code} · ${digitsRef.current} 位数，把房间号给对方`,
          )
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          try {
            peer.destroy()
          } catch {
            /* ignore */
          }
          peerRef.current = null
          if (!isPeerIdBusy(err) && attempt >= 3) break
        }
      }
      if (lastErr) {
        throw lastErr instanceof Error ? lastErr : new Error('开房失败，请重试')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '开房失败，请重试')
      peerRef.current?.destroy()
      peerRef.current = null
      setStatus('开房失败')
    } finally {
      setBusy(false)
    }
  }

  async function joinRoom(raw: string) {
    const code = normalizeRoomCode(raw)
    if (!isValidRoomCode(code)) {
      setError('房间号是 6 位数字')
      return
    }

    setError('')
    setBusy(true)

    let lastErr: unknown
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) {
          setStatus(`对方可能还在进房，重试加入（${attempt + 1}/5）…`)
          await new Promise((r) => window.setTimeout(r, 700 * attempt))
        }
        const myId = `${ROOM_PREFIX}${randomRoomCode()}-joiner-${Date.now().toString(36)}`
        peerRef.current?.destroy()
        connRef.current = null
        const peer = new Peer(myId, PEER_OPTIONS)
        peerRef.current = peer
        try {
          await waitPeerOpen(peer)

          const conn = peer.connect(`${ROOM_PREFIX}${code}`, { reliable: true })
          attachConnection(conn, code, false)

          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(
              () => reject(new Error('连不上，确认对方已进游戏')),
              10000,
            )
            conn.on('open', () => {
              window.clearTimeout(timer)
              resolve()
            })
            conn.on('error', (err) => {
              window.clearTimeout(timer)
              reject(err)
            })
          })

          persistRoom('joiner', code)
          setRoomCode(code)
          setPhase(secretLockedRef.current ? 'wait' : 'secret')
          setStatus(
            secretLockedRef.current
              ? '已重新连上，等待双方就绪'
              : '已进入房间，先写你的数字',
          )
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          try {
            peer.destroy()
          } catch {
            /* ignore */
          }
          peerRef.current = null
          connRef.current = null
        }
      }
      if (lastErr) {
        throw lastErr instanceof Error ? lastErr : new Error('加入失败')
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message}。可点重试，或回大厅重新开房`
          : '加入失败。可点重试，或回大厅重新开房',
      )
      peerRef.current?.destroy()
      peerRef.current = null
      connRef.current = null
      setStatus('加入失败')
    } finally {
      setBusy(false)
    }
  }

  function lockSecret() {
    if (!isValidNumber(secret, digits)) {
      setError(`要 ${digits} 位数字`)
      return
    }
    if (!connRef.current?.open) {
      setError('还没连上对方')
      return
    }
    setError('')
    setSecretLocked(true)
    secretLockedRef.current = true
    patchPeerRoom({
      secret,
      secretLocked: true,
      digits,
      who,
    })
    send({ type: 'secret-ready' })
    send({ type: 'hello', who, digits })
    if (peerReady) {
      setPhase('play')
      setStatus('开始猜吧，两边可以同时猜')
    } else {
      setPhase('wait')
      setStatus('已提交，等待对方提交')
    }
  }

  function submitGuess() {
    if (busy) return
    if (!isValidNumber(draftGuess, digits)) {
      setError(`猜测也要 ${digits} 位数字`)
      return
    }
    if (myGuesses.some((g) => g.guess === draftGuess)) {
      setError('这组已经猜过了')
      return
    }
    if (!connRef.current?.open) {
      setError('连接断开了')
      return
    }
    setError('')
    setBusy(true)
    send({
      type: 'guess',
      guess: draftGuess,
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    })
  }

  return (
    <GameShell title="猜数字">
      {phase === 'lobby' ? (
        <EnterRoomGate
          busy={busy}
          status={status}
          error={error}
          onRetry={resumeSavedRef.current ? () => retryResume() : undefined}
        />
      ) : null}

      {phase !== 'lobby' && roomCode ? (
        <RoomBanner
          code={roomCode}
          detail={
            peerWho
              ? `${digits} 位 · ${aboutLabel(who)} · ${aboutLabel(peerWho)}`
              : `${digits} 位数`
          }
        />
      ) : null}

      {phase !== 'lobby' ? (
        <p className="mb-5 text-sm text-[var(--ink-soft)]">{status}</p>
      ) : null}

      {(phase === 'secret' || phase === 'wait') && !secretLocked ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-[var(--ink-soft)]">位数</span>
            <div className="wall-filter">
              {([4, 5] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={digits === n ? 'is-on' : ''}
                  onClick={() => {
                    setDigits(n)
                    setSecret((s) => s.slice(0, n))
                  }}
                >
                  {n} 位
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm text-[var(--ink-soft)]">
            你的数字（{digits} 位）
          </label>
          <input
            value={secret}
            onChange={(e) =>
              setSecret(e.target.value.replace(/\D/g, '').slice(0, digits))
            }
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={digits}
            placeholder="你的数字"
            className="w-full bg-white/70 px-3 py-4 text-center font-display text-4xl tracking-[0.4em] outline-none ring-1 ring-[var(--leaf)]/20 focus:ring-[var(--leaf)]/45 placeholder:tracking-normal placeholder:text-base placeholder:text-[var(--ink-soft)]"
          />
          <button
            type="button"
            onClick={lockSecret}
            className="w-full bg-[var(--leaf)] px-4 py-3.5 text-[var(--foam)]"
          >
            提交
          </button>
        </div>
      ) : null}

      {phase === 'wait' && secretLocked ? (
        <div className="space-y-6 py-6 text-center">
          <MySecret digits={digits} secret={secret} />
          <p className="text-sm text-[var(--ink-soft)]">已提交，等对方…</p>
        </div>
      ) : null}

      {(phase === 'play' || phase === 'done') && (
        <div className="space-y-5">
          <MySecret digits={digits} secret={secret} />

          {phase === 'done' ? (
            <>
              <GuessOutcome
                myTurns={myGuesses.length}
                peerTurns={peerTurns ?? peerGuesses.length}
              />
              <div className="space-y-2">
                <p className="text-center text-sm text-[var(--ink-soft)]">
                  回房间后由开房方再选游戏
                </p>
                <button
                  type="button"
                  className="game-btn game-btn-leaf w-full"
                  disabled={busy}
                  onClick={() => void goHub()}
                >
                  {busy ? '返回中…' : '再来一局'}
                </button>
                <button
                  type="button"
                  className="game-btn game-btn-ghost w-full"
                  disabled={busy}
                  onClick={() => void goHub()}
                >
                  返回
                </button>
              </div>
            </>
          ) : null}

          {phase === 'play' && !iSolved ? (
            <div className="flex gap-2">
              <input
                value={draftGuess}
                onChange={(e) =>
                  setDraftGuess(e.target.value.replace(/\D/g, '').slice(0, digits))
                }
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={digits}
                placeholder="猜"
                className="min-w-0 flex-1 bg-white/70 px-3 py-3.5 text-center font-display text-2xl tracking-[0.35em] outline-none ring-1 ring-[var(--leaf)]/20 focus:ring-[var(--leaf)]/45"
              />
              <button
                type="button"
                disabled={busy}
                onClick={submitGuess}
                className="shrink-0 bg-[var(--leaf)] px-5 py-3.5 text-[var(--foam)] disabled:opacity-50"
              >
                {busy ? '…' : '猜'}
              </button>
            </div>
          ) : null}

          {phase === 'play' && iSolved && !peerSolved ? (
            <p className="text-center text-sm text-[var(--ink-soft)]">
              你已猜中，等对方…（比的是谁轮次更少）
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <GuessList title="你猜过的" guesses={myGuesses} />
            <GuessList title="对方猜过的" guesses={peerGuesses} />
          </div>
        </div>
      )}

      {phase !== 'lobby' && error ? (
        <p className="mt-4 text-sm text-red-700">{error}</p>
      ) : null}
    </GameShell>
  )
}

function GuessOutcome({
  myTurns,
  peerTurns,
}: {
  myTurns: number
  peerTurns: number
}) {
  const result =
    myTurns < peerTurns ? 'win' : myTurns > peerTurns ? 'lose' : 'draw'
  const title =
    result === 'win' ? '你赢了' : result === 'lose' ? '对方赢了' : '平局'

  return (
    <div
      className={[
        'guess-outcome',
        result === 'win' ? 'is-win' : '',
        result === 'draw' ? 'is-draw' : '',
        result === 'lose' ? 'is-lose' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="guess-outcome-title font-display">{title}</p>
      <p className="guess-outcome-meta">
        你 {myTurns} 轮 · 对方 {peerTurns} 轮
      </p>
      {result === 'win' ? <span className="guess-outcome-burst" aria-hidden /> : null}
    </div>
  )
}

function MySecret({ digits, secret }: { digits: DigitLen; secret: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/55 px-3 py-2.5">
      <span className="text-xs text-[var(--ink-soft)]">我出的题（{digits} 位）</span>
      <span className="font-display tracking-[0.28em] text-[var(--ink)]">{secret}</span>
    </div>
  )
}

function GuessList({ title, guesses }: { title: string; guesses: GuessResult[] }) {
  return (
    <div>
      <h2 className="text-xs tracking-wider text-[var(--ink-soft)]">{title}</h2>
      <ul className="mt-2 max-h-64 space-y-1.5 overflow-auto text-sm">
        {guesses.length === 0 ? (
          <li className="text-[var(--ink-soft)]">还没有</li>
        ) : (
          [...guesses].reverse().map((g) => (
            <li
              key={`${g.guess}-${g.at}`}
              className="flex items-center justify-between rounded-lg bg-white/50 px-2.5 py-1.5"
            >
              <span className="font-display tracking-[0.15em]">{g.guess}</span>
              <span className="text-[var(--leaf)]">{formatHits(g.hits)}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
