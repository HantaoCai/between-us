import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PlayOnlyFallback } from './components/PlayOnlyGuard'
import { PeerRoomProvider } from './lib/PeerRoomContext'
import { ArchivePage } from './pages/ArchivePage'
import { ChemistryPage } from './pages/games/ChemistryPage'
import { DicePage } from './pages/games/DicePage'
import { DrawGuessPage } from './pages/games/DrawGuessPage'
import { FlipPage } from './pages/games/FlipPage'
import { SelfDrawPage } from './pages/games/SelfDrawPage'
import { GomokuPage } from './pages/games/GomokuPage'
import { PokerPage } from './pages/games/PokerPage'
import { QuizPage } from './pages/games/QuizPage'
import { ReactionPage } from './pages/games/ReactionPage'
import { GamesPage } from './pages/GamesPage'
import { GuessPage } from './pages/GuessPage'
import { HomePage } from './pages/HomePage'
import { ImpressionsPage } from './pages/ImpressionsPage'
import { MemoryPage } from './pages/MemoryPage'
import { MilestonesPage } from './pages/MilestonesPage'
import { PlacesPage } from './pages/PlacesPage'

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'milestones', element: <MilestonesPage /> },
      { path: 'places', element: <PlacesPage /> },
      { path: 'impressions', element: <ImpressionsPage /> },
      { path: 'photos', element: <PlayOnlyFallback to="/" /> },
      { path: 'archive', element: <ArchivePage /> },
      { path: 'timeline', element: <PlayOnlyFallback to="/archive" /> },
      {
        path: 'games',
        // 房间 Peer 挂在这层：大厅 ↔ 各游戏换页不拆连接
        element: <PeerRoomProvider />,
        children: [
          { index: true, element: <GamesPage /> },
          { path: 'guess', element: <GuessPage /> },
          { path: 'quiz', element: <QuizPage /> },
          { path: 'draw', element: <DrawGuessPage /> },
          { path: 'selfdraw', element: <SelfDrawPage /> },
          { path: 'poker', element: <PokerPage /> },
          { path: 'dice', element: <DicePage /> },
          { path: 'reaction', element: <ReactionPage /> },
          { path: 'flip', element: <FlipPage /> },
          { path: 'gomoku', element: <GomokuPage /> },
          { path: 'chemistry', element: <ChemistryPage /> },
        ],
      },
      { path: 'how', element: <PlayOnlyFallback to="/" /> },
      { path: 'guess', element: <Navigate to="/games/guess" replace /> },
      { path: 'm/:slug', element: <MemoryPage /> },
      { path: '*', element: <PlayOnlyFallback to="/" /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
