import { Navigate, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing'
import Host from './pages/Host'
import Player from './pages/Player'
import Board from './pages/Board'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/host" element={<Host />} />
      <Route path="/play" element={<Player />} />
      <Route path="/board" element={<Board />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
