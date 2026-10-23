import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { getCurrentUser, logoutUser } from '@/lib/api'
import type { AuthMeResult } from '@/shared/types'
import { GameHeader } from './GameChrome'

export function useAdminAccount() {
  const [account, setAccount] = useState<AuthMeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    getCurrentUser().then(result => { if (active) setAccount(result) })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load your account') })
    return () => { active = false }
  }, [])
  return { account, error }
}

export function AdminNavigation({ superAdmin }: { superAdmin: boolean }) {
  return <nav className="admin-nav admin-page-nav" aria-label="Administration pages">
    {superAdmin && <NavLink to="/super-admin" end>Super Admin</NavLink>}
    <NavLink to="/admin" end>Games</NavLink>
    <NavLink to="/admin/participants">Participants</NavLink>
    {superAdmin && <NavLink to="/super-admin/admins">Create admin</NavLink>}
    <NavLink to="/admin/audit">Audit trail</NavLink>
  </nav>
}

export function AdminPage({ account, error, title, description, children }: {
  account: AuthMeResult | null; error: string | null; title: string; description: string; children: ReactNode
}) {
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  if (!account) return <main className="mx-auto max-w-6xl px-4 py-10">{error ? <><p role="alert" className="text-rose">{error}</p><Link className="btn mt-4" to="/login">Sign in</Link></> : <p role="status">Loading account…</p>}</main>
  return <main className="admin-workspace mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
    <GameHeader section={account.principal.type.replaceAll('_', ' ')}><button className="btn" disabled={signingOut} onClick={async () => {
      setSigningOut(true); setSignOutError(null)
      try { await logoutUser(); navigate('/login', { replace: true }) }
      catch (cause) { setSignOutError(cause instanceof Error ? cause.message : 'Could not sign out'); setSigningOut(false) }
    }}><LogOut size={14} aria-hidden="true" />Sign out</button></GameHeader>
    <div><h1 className="text-4xl font-bold sm:text-5xl">{title}</h1><p className="mt-3 text-sm text-slate-400">{description}</p></div>
    <AdminNavigation superAdmin={account.principal.type === 'SUPER_ADMIN'} />
    {signOutError && <p role="alert" className="card p-4 text-rose">{signOutError}</p>}
    {children}
  </main>
}
