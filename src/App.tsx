import { lazy } from 'react'
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PlayOnlyFallback } from './components/PlayOnlyGuard'
import { HomePage } from './pages/HomePage'

const MilestonesPage = lazy(() =>
  import('./pages/MilestonesPage').then((m) => ({ default: m.MilestonesPage })),
)
const PlacesPage = lazy(() =>
  import('./pages/PlacesPage').then((m) => ({ default: m.PlacesPage })),
)
const ImpressionsPage = lazy(() =>
  import('./pages/ImpressionsPage').then((m) => ({ default: m.ImpressionsPage })),
)
const ArchivePage = lazy(() =>
  import('./pages/ArchivePage').then((m) => ({ default: m.ArchivePage })),
)
const MemoryPage = lazy(() =>
  import('./pages/MemoryPage').then((m) => ({ default: m.MemoryPage })),
)
const PeerRoomProvider = lazy(() =>
  import('./lib/PeerRoomContext').then((m) => ({ default: m.PeerRoomProvider })),
)
const GamesPage = lazy(() =>
  import('./pages/GamesPage').then((m) => ({ default: m.GamesPage })),
)
const GuessPage = lazy(() =>
  import('./pages/GuessPage').then((m) => ({ default: m.GuessPage })),
)
const QuizPage = lazy(() =>
  import('./pages/games/QuizPage').then((m) => ({ default: m.QuizPage })),
)
const DrawGuessPage = lazy(() =>
  import('./pages/games/DrawGuessPage').then((m) => ({ default: m.DrawGuessPage })),
)
const SelfDrawPage = lazy(() =>
  import('./pages/games/SelfDrawPage').then((m) => ({ default: m.SelfDrawPage })),
)
const PokerPage = lazy(() =>
  import('./pages/games/PokerPage').then((m) => ({ default: m.PokerPage })),
)
const DicePage = lazy(() =>
  import('./pages/games/DicePage').then((m) => ({ default: m.DicePage })),
)
const ReactionPage = lazy(() =>
  import('./pages/games/ReactionPage').then((m) => ({ default: m.ReactionPage })),
)
const FlipPage = lazy(() =>
  import('./pages/games/FlipPage').then((m) => ({ default: m.FlipPage })),
)
const GomokuPage = lazy(() =>
  import('./pages/games/GomokuPage').then((m) => ({ default: m.GomokuPage })),
)
const ChemistryPage = lazy(() =>
  import('./pages/games/ChemistryPage').then((m) => ({
    default: m.ChemistryPage,
  })),
)

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
