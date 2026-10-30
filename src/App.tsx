import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ArchivePage } from './pages/ArchivePage'
import { HomePage } from './pages/HomePage'
import { HowPage } from './pages/HowPage'
import { ImpressionsPage } from './pages/ImpressionsPage'
import { MemoryPage } from './pages/MemoryPage'
import { MilestonesPage } from './pages/MilestonesPage'
import { PlacesPage } from './pages/PlacesPage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="milestones" element={<MilestonesPage />} />
          <Route path="places" element={<PlacesPage />} />
          <Route path="impressions" element={<ImpressionsPage />} />
          <Route path="photos" element={<Navigate to="/" replace />} />
          <Route path="archive" element={<ArchivePage />} />
          <Route path="timeline" element={<Navigate to="/archive" replace />} />
          <Route path="how" element={<HowPage />} />
          <Route path="m/:slug" element={<MemoryPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
