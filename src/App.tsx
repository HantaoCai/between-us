import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { HowPage } from './pages/HowPage'
import { MemoryPage } from './pages/MemoryPage'
import { PhotosPage } from './pages/PhotosPage'
import { TimelinePage } from './pages/TimelinePage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="photos" element={<PhotosPage />} />
          <Route path="how" element={<HowPage />} />
          <Route path="m/:slug" element={<MemoryPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
