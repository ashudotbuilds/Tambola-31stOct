import { Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import AccountGuard from './components/AccountGuard'
import Login from './pages/Login'
const Host = lazy(() => import('./pages/Host'))
const Player = lazy(() => import('./pages/Player'))
const Board = lazy(() => import('./pages/Board'))
const Admin = lazy(() => import('./pages/Admin'))
const ParticipantHome = lazy(() => import('./pages/ParticipantHome'))
const ParticipantRound = lazy(() => import('./pages/ParticipantRound'))
const RoundBoard = lazy(() => import('./pages/RoundBoard'))

export function App() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-5 py-16" role="status"><p className="eyebrow text-cyan">Technical Tambola</p><p className="mt-3 font-display text-2xl">Getting your screen ready…</p></main>}><Routes>
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
    </Routes></Suspense>
  )
}
