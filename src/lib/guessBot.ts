import { countHits, isDigitLen, isValidNumber, type DigitLen } from './guessGame'
import type { NoteAbout } from './notes'
import type { BotDriver, BotReply } from './botRoomSession'

function randomSecret(digits: DigitLen): string {
  let s = ''
  for (let i = 0; i < digits; i++) s += String(Math.floor(Math.random() * 10))
  return s
}

/** 猜数字：自持 secret 回 hits；并定时猜玩家 */
export function createGuessBotDriver(opts: {
  botWho: NoteAbout
  playerWho: NoteAbout
}): BotDriver {
  const botWho = opts.botWho
  const playerWho = opts.playerWho
  let destroyed = false
  let replyFn: BotReply | null = null
  let digits: DigitLen = 4
  let secret = randomSecret(4)
  let secretReady = true
  let myGuesses: string[] = []
  let peerProgress: { guess: string; hits: number }[] = []
  let iSolved = false
  let peerSolved = false
  let guessToken = 0
  let timers: number[] = []
  let awaitingResult: string | null = null

  function reply(data: unknown) {
    if (destroyed || !replyFn) return
    replyFn(data)
  }

  function later(ms: number, fn: () => void) {
    const id = window.setTimeout(() => {
      timers = timers.filter((t) => t !== id)
      if (!destroyed) fn()
    }, ms)
    timers.push(id)
  }

  function clearTimers() {
    for (const id of timers) window.clearTimeout(id)
    timers = []
  }

  function helloBack() {
    reply({ type: 'hello', who: botWho, digits })
    if (secretReady) {
      reply({ type: 'secret-ready', digits })
    }
  }

  function pickGuess(): string | null {
    // 用历史 hits 做简单位剪枝
    const fixed: Array<string | null> = Array.from({ length: digits }, () => null)
    for (const g of peerProgress) {
      if (g.hits === digits) {
        return null
      }
    }
    // 随机试探，避开已猜过的
    for (let attempt = 0; attempt < 80; attempt++) {
      const chars = Array.from({ length: digits }, (_, i) => {
        if (fixed[i]) return fixed[i]!
        return String(Math.floor(Math.random() * 10))
      })
      // 若某次历史全对位以外的信息不足，至少避开完全重复
      const guess = chars.join('')
      if (!myGuesses.includes(guess) && isValidNumber(guess, digits)) return guess
    }
    // 穷举退化
    const max = 10 ** digits
    for (let n = 0; n < max; n++) {
      const guess = String(n).padStart(digits, '0')
      if (!myGuesses.includes(guess)) return guess
    }
    return null
  }

  function scheduleGuess() {
    if (destroyed || iSolved || peerSolved) return
    if (awaitingResult) return
    const token = ++guessToken
    later(900 + Math.floor(Math.random() * 1100), () => {
      if (destroyed || token !== guessToken || iSolved) return
      if (awaitingResult) return
      const guess = pickGuess()
      if (!guess) return
      const requestId = `bot-${Date.now()}-${guess}`
      awaitingResult = guess
      myGuesses.push(guess)
      reply({ type: 'guess', guess, requestId })
    })
  }

  function resetMatch(nextDigits: DigitLen) {
    clearTimers()
    guessToken += 1
    digits = nextDigits
    secret = randomSecret(nextDigits)
    secretReady = true
    myGuesses = []
    peerProgress = []
    iSolved = false
    peerSolved = false
    awaitingResult = null
    helloBack()
    scheduleGuess()
  }

  return {
    onFromPlayer(raw, replyToPlayer) {
      if (destroyed) return
      replyFn = replyToPlayer
      if (!raw || typeof raw !== 'object' || !('type' in raw)) return
      const msg = raw as {
        type: string
        who?: NoteAbout
        digits?: number
        guess?: string
        requestId?: string
        hits?: number
        guesses?: { guess: string; hits: number }[]
        turns?: number
        secret?: string
        seq?: number
      }

      if (msg.type === 'hello') {
        if (typeof msg.digits === 'number' && isDigitLen(msg.digits)) {
          if (msg.digits !== digits) {
            digits = msg.digits
            secret = randomSecret(digits)
            myGuesses = []
            peerProgress = []
            iSolved = false
            peerSolved = false
            awaitingResult = null
          }
        }
        helloBack()
        scheduleGuess()
        return
      }
      if (msg.type === 'hub-pick' || msg.type === 'hub-return') return

      if (msg.type === 'digits') {
        if (typeof msg.digits === 'number' && isDigitLen(msg.digits)) {
          resetMatch(msg.digits)
        }
        return
      }

      if (msg.type === 'need-sync') {
        helloBack()
        if (myGuesses.length > 0) {
          reply({
            type: 'progress',
            guesses: myGuesses.map((g, i) => ({
              guess: g,
              hits: i,
              at: Date.now(),
            })),
          })
        }
        return
      }

      if (msg.type === 'secret-ready') {
        scheduleGuess()
        return
      }

      if (msg.type === 'guess') {
        if (typeof msg.guess !== 'string' || typeof msg.requestId !== 'string') return
        const hits = countHits(secret, msg.guess)
        if (hits == null) {
          reply({
            type: 'guess-result',
            requestId: msg.requestId,
            guess: msg.guess,
            hits: -1,
          })
          return
        }
        reply({
          type: 'guess-result',
          requestId: msg.requestId,
          guess: msg.guess,
          hits,
        })
        peerProgress.push({ guess: msg.guess, hits })
        if (hits === digits) {
          peerSolved = true
          reply({ type: 'solved', turns: peerProgress.length })
        }
        return
      }

      if (msg.type === 'guess-result') {
        if (typeof msg.guess !== 'string' || typeof msg.hits !== 'number') return
        if (msg.guess !== awaitingResult && awaitingResult != null) {
          // 仍接受
        }
        if (msg.guess === awaitingResult) awaitingResult = null
        if (msg.hits < 0) {
          scheduleGuess()
          return
        }
        // 记下对自己猜测的反馈，供剪枝（简化：只记命中全中）
        if (msg.hits === digits) {
          iSolved = true
          reply({ type: 'solved', turns: myGuesses.length })
          reply({
            type: 'reveal',
            who: botWho,
            secret,
            digits,
          })
          return
        }
        scheduleGuess()
        return
      }

      if (msg.type === 'progress') {
        if (!Array.isArray(msg.guesses)) return
        peerProgress = msg.guesses
          .filter((g) => g && typeof g.guess === 'string' && typeof g.hits === 'number')
          .map((g) => ({ guess: g.guess, hits: g.hits }))
        return
      }

      if (msg.type === 'solved') {
        peerSolved = true
        return
      }

      if (msg.type === 'reveal') {
        return
      }

      if (msg.type === 'resign') {
        iSolved = true
        return
      }

      if (msg.type === 'restart-ask') {
        if (typeof msg.seq !== 'number') return
        reply({ type: 'restart-ok', seq: msg.seq })
        resetMatch(digits)
        return
      }

      if (msg.type === 'restart-ok' || msg.type === 'again') {
        resetMatch(digits)
        return
      }

      if (msg.type === 'restart-no') return

      void playerWho
    },
    destroy() {
      destroyed = true
      guessToken += 1
      clearTimers()
      replyFn = null
    },
  }
}
