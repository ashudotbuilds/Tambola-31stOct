import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AdminPage, useAdminAccount } from '@/components/AdminNavigation'
import { listAudit, type AuditEntry, type AuditFilters, type AuditResult } from '@/lib/api'
import { auditDescription, auditLabel, auditLabels } from '@/lib/audit'

export default function Audit() {
  const { account, error } = useAdminAccount()
  const [params] = useSearchParams()
  const gameId = params.get('game') ?? undefined
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [game, setGame] = useState<AuditResult['game']>(null)
  const [filters, setFilters] = useState<AuditFilters>({})
  const [loading, setLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const requestId = useRef(0)
  useEffect(() => {
    const id = ++requestId.current
    setLoading(true); setAuditError(null); setEntries([]); setCursor(null); setGame(null)
    listAudit({ ...filters, gameId, limit: 30 }).then(result => {
      if (id === requestId.current) { setEntries(result.entries); setCursor(result.nextCursor); setGame(result.game) }
    }).catch(cause => { if (id === requestId.current) setAuditError(cause instanceof Error ? cause.message : 'Could not load audit') })
      .finally(() => { if (id === requestId.current) setLoading(false) })
    return () => { requestId.current++ }
  }, [filters, gameId])
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const date = (key: string) => data.get(key) ? new Date(String(data.get(key))).toISOString() : undefined
    setFilters({ search: String(data.get('search') ?? '').trim() || undefined, action: String(data.get('action') ?? '') || undefined,
      suspicious: data.get('suspicious') === 'on', from: date('from'), to: date('to') })
  }
  async function loadMore() {
    if (!cursor || loading) return
    const id = requestId.current
    setLoading(true); setAuditError(null)
    try {
      const result = await listAudit({ ...filters, gameId, cursor, limit: 30 })
      if (id === requestId.current) { setEntries(current => [...current, ...result.entries]); setCursor(result.nextCursor) }
    } catch (cause) { if (id === requestId.current) setAuditError(cause instanceof Error ? cause.message : 'Could not load more') }
    finally { if (id === requestId.current) setLoading(false) }
  }
  return <AdminPage account={account} error={error} title={game ? `Game ${game.code} · Audit trail` : 'Audit trail'} description="See who did what, when it happened, and which activity needs review.">
    {gameId && <Link className="text-sm text-cyan underline" to="/admin/audit">View all activity</Link>}
    {game && <p className="text-sm text-slate-400">Host: {game.host ?? 'Administrator'} · {game.deleted ? 'Deleted · audit retained' : game.status} · Includes account activity during this game.</p>}
    {auditError && <p role="alert" className="card p-4 text-rose">{auditError}</p>}
    <section id="audit" className="card p-4 sm:p-5">
      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={filter}>
        <label className="text-xs">Name, email or game code<input className="field mt-1" name="search" placeholder="Search people or games" maxLength={200} /></label>
        <label className="text-xs">Activity<select aria-label="Activity" name="action" className="field mt-1"><option value="">All activity</option>{Object.entries(auditLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-xs">From<input className="field mt-1" name="from" type="datetime-local" /></label>
        <label className="text-xs">To<input className="field mt-1" name="to" type="datetime-local" /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input name="suspicious" type="checkbox" className="h-4 w-4 accent-cyan" />Only activity needing review</label>
        <button className="btn sm:col-span-2" disabled={loading}>{loading ? 'Loading…' : 'Apply filters'}</button>
      </form>
      <p className="mt-4 text-xs leading-relaxed text-slate-400">Review flags are signals, not proof of misconduct. Multiple tabs and unstable networks can cause extra connections. Times use your device’s local timezone.</p>
      <div className="mt-4 divide-y divide-edge" aria-live="polite" aria-busy={loading}>
        {entries.map(entry => <article key={entry.id} className="min-w-0 space-y-2 py-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-slate-100">{auditLabel(entry.action)}</h2>{entry.suspicious && <span className="rounded border border-amber/60 bg-amber/10 px-2 py-1 text-[10px] font-bold text-amber">Needs review</span>}
            {entry.gameCode && <Link className="text-xs text-cyan underline" to={`/admin/audit?game=${entry.resourceId}`}>Game {entry.gameCode}</Link>}</div>
            <time dateTime={entry.createdAt} className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })}</time>
          </div>
          <p className="break-words font-semibold">{entry.actorName ?? (entry.actorEmail ? 'Unverified login attempt' : entry.actorId ? 'Unavailable account' : 'System')}<span className="ml-2 font-normal text-slate-400">{entry.actorEmail ?? 'No account email available'}</span></p>
          {auditDescription(entry) && <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-300">{auditDescription(entry)}</p>}
          {(entry.ipAddress || entry.userAgent) && <details className="text-xs text-slate-400"><summary className="cursor-pointer">Connection details</summary><p className="break-words">{entry.ipAddress && `IP: ${entry.ipAddress}`}</p><p className="mt-1 break-words">{entry.userAgent}</p></details>}
        </article>)}
        {!entries.length && <p className="py-4 text-sm text-slate-400">{loading ? 'Loading activity…' : 'No matching activity.'}</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{cursor && <button className="btn" onClick={loadMore} disabled={loading}>Load more</button>}<button className="btn" disabled={loading} onClick={() => setFilters(current => ({ ...current }))}>Refresh activity</button></div>
    </section>
  </AdminPage>
}
