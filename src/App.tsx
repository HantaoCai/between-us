import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PlayOnlyFallback } from './components/PlayOnlyGuard'
import { HomePage } from './pages/HomePage'

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'milestones',
        lazy: async () => {
          const { MilestonesPage } = await import('./pages/MilestonesPage')
          return { Component: MilestonesPage }
        },
      },
      {
        path: 'places',
        lazy: async () => {
          const { PlacesPage } = await import('./pages/PlacesPage')
          return { Component: PlacesPage }
        },
      },
      {
        path: 'impressions',
        lazy: async () => {
          const { ImpressionsPage } = await import('./pages/ImpressionsPage')
          return { Component: ImpressionsPage }
        },
      },
      { path: 'photos', element: <PlayOnlyFallback to="/" /> },
      {
        path: 'archive',
        lazy: async () => {
          const { ArchivePage } = await import('./pages/ArchivePage')
          return { Component: ArchivePage }
        },
      },
      { path: 'timeline', element: <PlayOnlyFallback to="/archive" /> },
      {
        path: 'games',
        // 房间 Peer 挂在这层：大厅 ↔ 各游戏换页不拆连接；整支懒加载，避免首页背 PeerJS/游戏包
        lazy: async () => {
          const { PeerRoomProvider } = await import('./lib/PeerRoomContext')
          return { Component: PeerRoomProvider }
        },
        children: [
          {
            index: true,
            lazy: async () => {
              const { GamesPage } = await import('./pages/GamesPage')
              return { Component: GamesPage }
            },
          },
          {
            path: 'guess',
            lazy: async () => {
              const { GuessPage } = await import('./pages/GuessPage')
              return { Component: GuessPage }
            },
          },
          {
            path: 'quiz',
            lazy: async () => {
              const { QuizPage } = await import('./pages/games/QuizPage')
              return { Component: QuizPage }
            },
          },
          {
            path: 'draw',
            lazy: async () => {
              const { DrawGuessPage } = await import('./pages/games/DrawGuessPage')
              return { Component: DrawGuessPage }
            },
          },
          {
            path: 'selfdraw',
            lazy: async () => {
              const { SelfDrawPage } = await import('./pages/games/SelfDrawPage')
              return { Component: SelfDrawPage }
            },
          },
          {
            path: 'poker',
            lazy: async () => {
              const { PokerPage } = await import('./pages/games/PokerPage')
              return { Component: PokerPage }
            },
          },
          {
            path: 'dice',
            lazy: async () => {
              const { DicePage } = await import('./pages/games/DicePage')
              return { Component: DicePage }
            },
          },
          {
            path: 'reaction',
            lazy: async () => {
              const { ReactionPage } = await import('./pages/games/ReactionPage')
              return { Component: ReactionPage }
            },
          },
          {
            path: 'flip',
            lazy: async () => {
              const { FlipPage } = await import('./pages/games/FlipPage')
              return { Component: FlipPage }
            },
          },
          {
            path: 'gomoku',
            lazy: async () => {
              const { GomokuPage } = await import('./pages/games/GomokuPage')
              return { Component: GomokuPage }
            },
          },
          {
            path: 'chemistry',
            lazy: async () => {
              const { ChemistryPage } = await import('./pages/games/ChemistryPage')
              return { Component: ChemistryPage }
            },
          },
        ],
      },
      { path: 'how', element: <PlayOnlyFallback to="/" /> },
      { path: 'guess', element: <Navigate to="/games/guess" replace /> },
      {
        path: 'm/:slug',
        lazy: async () => {
          const { MemoryPage } = await import('./pages/MemoryPage')
          return { Component: MemoryPage }
        },
      },
      { path: '*', element: <PlayOnlyFallback to="/" /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
