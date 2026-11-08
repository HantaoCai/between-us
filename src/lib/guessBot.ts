import { countHits, isDigitLen, isValidNumber, type DigitLen } from './guessGame'
import type { NoteAbout } from './notes'
import type { BotDriver, BotReply } from './botRoomSession'

function randomSecret(digits: DigitLen): string {
  let s = ''
  for (let i = 0; i < digits; i++) s += String(Math.floor(Math.random() * 10))
  return s
}

/** 猜数字：自持 secret 回 hits；等双方出题后再猜 */
export function createGuessBotDriver(opts: {
  botWho: NoteAbout
  playerWho: NoteAbout
}): BotDriver {
  const botWho = opts.botWho
  void opts.playerWho
  let destroyed = false
  let replyFn: BotReply | null = null
  let digits: DigitLen = 4
  let secret = randomSecret(4)
  let playerReady = false
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

  function announceReady() {
    reply({ type: 'secret-ready', digits })
  }

  function helloBack() {
    reply({ type: 'hello', who: botWho, digits })
    // 机器人开局就出好题；多发一次防丢
    announceReady()
    later(80, () => {
      if (!destroyed) announceReady()
    })
  }

  function pickGuess(): string | null {
    for (const g of peerProgress) {
      if (g.hits === digits) return null
    }
    for (let attempt = 0; attempt < 80; attempt++) {
      let guess = ''
      for (let i = 0; i < digits; i++) guess += String(Math.floor(Math.random() * 10))
      if (!myGuesses.includes(guess) && isValidNumber(guess, digits)) return guess
    }
    const max = 10 ** digits
    for (let n = 0; n < max; n++) {
      const guess = String(n).padStart(digits, '0')
      if (!myGuesses.includes(guess)) return guess
    }
    return null
  }

  function scheduleGuess() {
    if (destroyed || iSolved || peerSolved) return
    if (!playerReady) return
    if (awaitingResult) return
    const token = ++guessToken
    later(900 + Math.floor(Math.random() * 1100), () => {
      if (destroyed || token !== guessToken || iSolved || !playerReady) return
      if (awaitingResult) return
      const guess = pickGuess()
      if (!guess) return
      const requestId = `bot-${Date.now()}-${guess}`
      awaitingResult = guess
      myGuesses.push(guess)
      reply({ type: 'guess', guess, requestId })
    })
  }

  function notePlayerReady() {
    playerReady = true
    // 玩家刚提交：立刻再报一次就绪，避免卡在「等对方」
    announceReady()
    later(60, () => {
      if (!destroyed) announceReady()
    })
    scheduleGuess()
  }

  function alignDigits(next: DigitLen) {
    if (next === digits) return
    digits = next
    secret = randomSecret(next)
    myGuesses = []
    peerProgress = []
    iSolved = false
    peerSolved = false
    awaitingResult = null
    playerReady = false
    guessToken += 1
  }

  function resetMatch(nextDigits: DigitLen) {
    clearTimers()
    guessToken += 1
    alignDigits(nextDigits)
    secret = randomSecret(nextDigits)
    digits = nextDigits
    playerReady = false
    myGuesses = []
    peerProgress = []
    iSolved = false
    peerSolved = false
    awaitingResult = null
    helloBack()
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
          alignDigits(msg.digits)
        }
        helloBack()
        if (playerReady) scheduleGuess()
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
        if (playerReady) announceReady()
        return
      }

      if (msg.type === 'secret-ready') {
        if (typeof msg.digits === 'number' && isDigitLen(msg.digits)) {
          if (msg.digits !== digits) alignDigits(msg.digits)
        }
        notePlayerReady()
        return
      }

      if (msg.type === 'secret-share') {
        // 对战端不展示，但当作对方已出题
        if (typeof msg.digits === 'number' && isDigitLen(msg.digits)) {
          if (msg.digits !== digits) alignDigits(msg.digits)
        }
        notePlayerReady()
        return
      }

      if (msg.type === 'guess') {
        if (typeof msg.guess !== 'string' || typeof msg.requestId !== 'string') return
        // 玩家已在猜，说明双方都已出题
        if (!playerReady) notePlayerReady()
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
        if (msg.guess === awaitingResult) awaitingResult = null
        if (msg.hits < 0) {
          // 对方还没锁题：稍后再试，勿狂发
          later(1200, () => scheduleGuess())
          return
        }
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

      if (msg.type === 'reveal') return

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
    },
    destroy() {
      destroyed = true
      guessToken += 1
      clearTimers()
      replyFn = null
    },
  }
}
