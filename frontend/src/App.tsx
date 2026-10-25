import { Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import AccountGuard from './components/AccountGuard'
import Login from './pages/Login'
const Host = lazy(() => import('./pages/Host'))
const Player = lazy(() => import('./pages/Player'))
const Board = lazy(() => import('./pages/Board'))
const Admin = lazy(() => import('./pages/Admin'))
const SuperAdmin = lazy(() => import('./pages/SuperAdmin'))
const AdminAccounts = lazy(() => import('./pages/AdminAccounts'))
const Participants = lazy(() => import('./pages/Participants'))
const Audit = lazy(() => import('./pages/Audit'))
const ParticipantHome = lazy(() => import('./pages/ParticipantHome'))
const LoadTestSetup = lazy(() => import('./pages/LoadTestSetup'))

export function App() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-5 py-16" role="status"><p className="eyebrow text-cyan">Technical Tambola</p><p className="mt-3 font-display text-2xl">Getting your screen ready…</p></main>}><Routes>
      <Route path="/" element={<Login />} />
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<AccountGuard role="admin"><Admin /></AccountGuard>} />
      <Route path="/super-admin" element={<AccountGuard role="super-admin"><SuperAdmin /></AccountGuard>} />
      <Route path="/super-admin/admins" element={<AccountGuard role="super-admin"><AdminAccounts /></AccountGuard>} />
      <Route path="/super-admin/load-test" element={<AccountGuard role="super-admin"><LoadTestSetup /></AccountGuard>} />
      <Route path="/admin/participants" element={<AccountGuard role="admin"><Participants /></AccountGuard>} />
      <Route path="/admin/events" element={<Navigate to="/admin/participants" replace />} />
      <Route path="/admin/rounds" element={<Navigate to="/admin" replace />} />
      <Route path="/admin/audit" element={<AccountGuard role="admin"><Audit /></AccountGuard>} />
      <Route path="/account" element={<AccountGuard role="member"><ParticipantHome /></AccountGuard>} />
      <Route path="/host" element={<AccountGuard role="admin"><Host /></AccountGuard>} />
      <Route path="/play" element={<AccountGuard role="member"><Player /></AccountGuard>} />
      <Route path="/board" element={<AccountGuard role="admin"><Board /></AccountGuard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense>
  )
}
