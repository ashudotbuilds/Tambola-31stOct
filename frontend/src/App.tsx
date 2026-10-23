import { Navigate, Route, Routes } from 'react-router-dom'
import AccountGuard from './components/AccountGuard'
import Host from './pages/Host'
import Player from './pages/Player'
import Board from './pages/Board'
import Login from './pages/Login'
import Admin from './pages/Admin'
import ParticipantHome from './pages/ParticipantHome'
import ParticipantRound from './pages/ParticipantRound'
import RoundBoard from './pages/RoundBoard'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<AccountGuard role="admin"><Admin /></AccountGuard>} />
      <Route path="/account" element={<AccountGuard role="member"><ParticipantHome /></AccountGuard>} />
      <Route path="/account/round/:roundId" element={<AccountGuard role="member"><ParticipantRound /></AccountGuard>} />
      <Route path="/display/round/:roundId" element={<AccountGuard><RoundBoard /></AccountGuard>} />
      <Route path="/host" element={<AccountGuard role="admin"><Host /></AccountGuard>} />
      <Route path="/play" element={<AccountGuard role="member"><Player /></AccountGuard>} />
      <Route path="/board" element={<AccountGuard role="admin"><Board /></AccountGuard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
