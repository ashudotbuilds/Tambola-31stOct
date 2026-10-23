import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getCurrentUser, logoutUser } from '@/lib/api'
import type { AuthMeResult } from '@/shared/types'
import { createGame } from '@/lib/api'
import { useAdminDashboard } from '@/hooks/useAdminDashboard'
import { AdminGames } from '@/components/AdminGames'
import { AdminNavigation } from '@/components/AdminNavigation'
import { GameHeader } from '@/components/GameChrome'
import { LogOut, Plus } from 'lucide-react'

export default function Admin() {
  const navigate = useNavigate()
  const [account, setAccount] = useState<AuthMeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [adminBusy, setAdminBusy] = useState(false)
  const { games, dashboard, error: dashboardError, loading, refresh } = useAdminDashboard(!!account && account.principal.type !== 'PARTICIPANT')

  useEffect(() => {
    let active = true
    getCurrentUser().then(async result => {
      if (!active) return
      if (result.principal.type === 'PARTICIPANT') {
        navigate('/account', { replace: true })
        return
      }
      setAccount(result)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load your session')
    }).finally(() => {
      if (active) setBusy(false)
    })
    return () => { active = false }
  }, [navigate])

  async function signOut() {
    setBusy(true)
    try {
      await logoutUser()
      navigate('/login', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out')
      setBusy(false)
    }
  }

  if (busy) return <main className="mx-auto max-w-4xl px-4 py-12" role="status">Loading account…</main>
  if (!account) return <main className="mx-auto max-w-md px-4 py-12"><p role="alert" className="card p-4 text-sm text-rose">{error ?? 'Sign in to continue.'}</p><Link className="btn btn-primary mt-4" to="/login">Go to sign in</Link></main>

  const role = account.principal.role ?? account.principal.type
  return (
    <main className="admin-workspace mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
      <GameHeader section={role.replaceAll('_', ' ')}><button className="btn" type="button" onClick={signOut} disabled={busy}><LogOut size={14} />Sign out</button></GameHeader>
      <div className="flex flex-wrap items-end justify-between gap-5 pt-2"><div><p className="eyebrow text-cyan">Welcome back, {account.user.name}</p><h1 className="mt-2 text-4xl font-bold sm:text-5xl">Game control.</h1><p className="mt-2 text-sm text-slate-400">Set the pace. Keep the game moving.</p></div>
        <button className="btn btn-primary" disabled={adminBusy} onClick={async()=>{setAdminBusy(true);try{await createGame(account.user.name);navigate('/host')}catch(cause){setError(cause instanceof Error?cause.message:'Could not create game')}finally{setAdminBusy(false)}}}><Plus size={16} />Create a game</button>
      </div>
      <AdminNavigation superAdmin={account.principal.type === 'SUPER_ADMIN'} />
      {error && <p role="alert" className="rounded-xl border border-rose/50 bg-rose/10 px-4 py-3 text-sm text-rose">{error}</p>}
      <AdminGames games={games} loading={loading} refresh={refresh} />
      {account.principal.type !== 'PARTICIPANT' && <section id="operations" className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Operations dashboard</h2><button type="button" className="btn min-h-9 px-3 text-xs" onClick={refresh}>Refresh</button></div>
        {dashboardError && <p role="alert" className="mt-3 text-sm text-rose">Dashboard unavailable: {dashboardError}</p>}
        {!dashboardError && dashboard && <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[
            ['Participants', dashboard.counts.participants], ['Games', dashboard.counts.games], ['Active games', dashboard.counts.activeGames], ['Calls', dashboard.counts.draws], ['Accepted claims', dashboard.counts.acceptedClaims], ['Connections', dashboard.socketConnections],
          ].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-edge p-3"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 text-xl font-bold">{value}</dd></div>)}</dl>
        </>}
      </section>}
      <section className="card p-5">
        <h2 className="text-lg font-bold">Signed in</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-400">Name</dt><dd>{account.user.name}</dd></div>
          <div><dt className="text-slate-400">Email</dt><dd>{account.user.email}</dd></div>
          <div><dt className="text-slate-400">Access</dt><dd>{role}</dd></div>
          <div><dt className="text-slate-400">Account status</dt><dd>{account.user.status}</dd></div>
        </dl>
      </section>
      <section className="card p-5">
        <h2 className="text-lg font-bold">Game operations</h2>
        <button className="btn btn-primary mt-3" disabled={adminBusy} onClick={async()=>{setAdminBusy(true);try{await createGame(account.user.name);navigate('/host')}catch(cause){setError(cause instanceof Error?cause.message:'Could not create game')}finally{setAdminBusy(false)}}}>Create a game</button>
        <p className="mt-1 text-sm text-slate-400">Create a game, share its code with members, then start when everyone is ready.</p>
        <Link to="/host" className="btn mt-4">Resume game console</Link>
      </section>
    </main>
  )
}
