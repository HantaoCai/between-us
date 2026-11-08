import type { BotDriver } from './botRoomSession'
import { createChemistryBotDriver } from './chemistryBot'
import { createFlipBotDriver } from './flipBot'
import { createGomokuBotDriver } from './gomokuBot'
import { createGuessBotDriver } from './guessBot'
import { createHubBotDriver } from './hubBot'
import type { NoteAbout } from './notes'
import { createPokerBotDriver } from './pokerBot'
import type { PeerPlayGameId } from './peerRoomSave'
import { createQuizBotDriver } from './quizBot'
import { createReactionBotDriver } from './reactionBot'
import { isSoloCapableGame } from './soloGames'

export type BotDriverGame = PeerPlayGameId | 'hub'

/** 按游戏创建 BotDriver；大厅用 hub；未知可人机游戏回退 hub */
export function createBotDriverForGame(
  game: BotDriverGame,
  opts: { botWho: NoteAbout; playerWho: NoteAbout },
): BotDriver {
  const { botWho, playerWho } = opts
  if (game === 'hub') return createHubBotDriver({ botWho, playerWho })
  if (!isSoloCapableGame(game)) return createHubBotDriver({ botWho, playerWho })

  switch (game) {
    case 'gomoku':
      return createGomokuBotDriver({ botWho, playerWho })
    case 'reaction':
      return createReactionBotDriver({ botWho, playerWho })
    case 'flip':
      return createFlipBotDriver({ botWho, playerWho })
    case 'quiz':
      return createQuizBotDriver({ botWho, playerWho })
    case 'chemistry':
      return createChemistryBotDriver({ botWho, playerWho })
    case 'guess':
      return createGuessBotDriver({ botWho, playerWho })
    case 'poker':
      return createPokerBotDriver({ botWho, playerWho })
    default:
      return createHubBotDriver({ botWho, playerWho })
  }
}
