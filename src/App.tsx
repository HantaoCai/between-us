import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ArchivePage } from './pages/ArchivePage'
import { DicePage } from './pages/games/DicePage'
import { DrawGuessPage } from './pages/games/DrawGuessPage'
import { FlipPage } from './pages/games/FlipPage'
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
      { path: 'photos', element: <Navigate to="/" replace /> },
      { path: 'archive', element: <ArchivePage /> },
      { path: 'timeline', element: <Navigate to="/archive" replace /> },
      { path: 'games', element: <GamesPage /> },
      { path: 'how', element: <Navigate to="/" replace /> },
      { path: 'games/guess', element: <GuessPage /> },
      { path: 'games/quiz', element: <QuizPage /> },
      { path: 'games/draw', element: <DrawGuessPage /> },
      { path: 'games/poker', element: <PokerPage /> },
      { path: 'games/dice', element: <DicePage /> },
      { path: 'games/reaction', element: <ReactionPage /> },
      { path: 'games/flip', element: <FlipPage /> },
      { path: 'guess', element: <Navigate to="/games/guess" replace /> },
      { path: 'm/:slug', element: <MemoryPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
