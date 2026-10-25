import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminPage, useAdminAccount } from '@/components/AdminNavigation'
import { getSystemDiagnostics } from '@/lib/api'
import { useAdminDashboard } from '@/hooks/useAdminDashboard'
import { AdminGames } from '@/components/AdminGames'

export default function SuperAdmin() {
  const { account, error } = useAdminAccount()
  const [system, setSystem] = useState<Awaited<ReturnType<typeof getSystemDiagnostics>> | null>(null)
  const { games, dashboard, error: dashboardError, loading: gamesLoading, refresh } = useAdminDashboard(!!account)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    getSystemDiagnostics().then(diagnostics => {
      if (active) setSystem(diagnostics)
    }).catch(cause => { if (active) setLoadError(cause instanceof Error ? cause.message : 'Could not load system overview') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  return <AdminPage account={account} error={error} title="Super Admin" description="System health, access management, and game oversight.">
    {loading && <p role="status">Loading system overview…</p>}
    {loadError && <p role="alert" className="card p-4 text-rose">{loadError}</p>}
    {system && <section className="card p-5"><h2 className="text-xl font-bold">System diagnostics</h2><dl className="mt-4 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">{[
      ['Application version', system.version ?? 'Unavailable'], ['Node runtime', system.nodeVersion], ['Readiness', system.readiness ? 'Ready' : 'Not ready'], ['Latest migration', system.latestMigration ?? 'Unavailable'],
    ].map(([label, value]) => <div className="min-w-0" key={String(label)}><dt className="text-slate-400">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}</dl></section>}
    {dashboardError && <p role="alert" className="card p-4 text-rose">{dashboardError}</p>}
    <AdminGames games={games} loading={gamesLoading} refresh={refresh} />
    {dashboard && <section className="card p-5"><h2 className="text-xl font-bold">Operations overview</h2><dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[
      ['Participants', dashboard.counts.participants], ['Active games', dashboard.counts.activeGames], ['Accepted claims', dashboard.counts.acceptedClaims], ['Connections', dashboard.socketConnections],
    ].map(([label, value]) => <div className="rounded border border-edge p-3" key={String(label)}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-2 text-2xl">{value}</dd></div>)}</dl></section>}
    <div className="grid gap-4 sm:grid-cols-3">{[
      ['/super-admin/admins', 'Create admin', 'Create and manage administrator accounts.'], ['/super-admin/load-test', 'Load test setup', 'Create dedicated accounts for the k6 load test.'], ['/admin/audit', 'Audit trail', 'Filter and inspect recorded actions.'], ['/admin', 'Games', 'Create and manage games.'], ['/admin/participants', 'Participants', 'Import players and manage credentials.'],
    ].map(([path, title, description]) => <Link to={path} className="card block p-5 transition-colors hover:border-cyan" key={path}><h2 className="text-xl font-bold text-cyan">{title} →</h2><p className="mt-3 text-sm text-slate-400">{description}</p></Link>)}</div>
  </AdminPage>
}
