import { useEffect, useState, type FormEvent } from 'react'
import { AdminPage, useAdminAccount } from '@/components/AdminNavigation'
import { listAudit, type AuditEntry } from '@/lib/api'

export default function Audit() {
  const { account, error } = useAdminAccount()
  const [adminError, setAdminError] = useState<string | null>(null)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditCursor, setAuditCursor] = useState<string | null>(null)
  const [auditAction, setAuditAction] = useState('')
  const [auditActor, setAuditActor] = useState('')
  const [auditFrom, setAuditFrom] = useState('')
  const [auditTo, setAuditTo] = useState('')
  const [auditLoading, setAuditLoading] = useState(false)
  useEffect(() => {
    let active = true
    setAuditLoading(true)
    listAudit({ limit: 20 }).then(result => { if (active) { setAuditEntries(result.entries); setAuditCursor(result.nextCursor) } }).catch(cause => { if (active) setAdminError(cause instanceof Error ? cause.message : 'Audit log is unavailable') }).finally(() => { if (active) setAuditLoading(false) })
    return () => { active = false }
  }, [])
  async function filterAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setAuditLoading(true); setAdminError(null)
    try {
      const action = String(data.get('auditAction') ?? '').trim()
      const actorId = String(data.get('actorId') ?? '').trim()
      const fromRaw = String(data.get('from') ?? '')
      const toRaw = String(data.get('to') ?? '')
      const from = fromRaw ? new Date(fromRaw).toISOString() : undefined
      const to = toRaw ? new Date(toRaw).toISOString() : undefined
      setAuditAction(action)
      setAuditActor(actorId); setAuditFrom(from ?? ''); setAuditTo(to ?? '')
      const result = await listAudit({ limit: 20, action: action || undefined, actorId: actorId || undefined, from, to })
      setAuditEntries(result.entries); setAuditCursor(result.nextCursor)
    } catch (cause) { setAdminError(cause instanceof Error ? cause.message : 'Could not load audit entries') }
    finally { setAuditLoading(false) }
  }

  async function loadMoreAudit() {
    if (!auditCursor) return
    setAuditLoading(true)
    try {
      const result = await listAudit({ limit: 20, action: auditAction || undefined, actorId: auditActor || undefined, from: auditFrom || undefined, to: auditTo || undefined, cursor: auditCursor })
      setAuditEntries(current => [...current, ...result.entries]); setAuditCursor(result.nextCursor)
    } catch (cause) { setAdminError(cause instanceof Error ? cause.message : 'Could not load more audit entries') }
    finally { setAuditLoading(false) }
  }

  return <AdminPage account={account} error={error} title="Audit trail" description="Search actions, inspect changes, and trace account activity.">
    {adminError && <p role="alert" className="card p-4 text-rose">{adminError}</p>}
      <section id="audit" className="card p-5">
        <h2 className="text-lg font-bold">Audit trail</h2>
        <form className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={filterAudit}>
          <label className="text-xs">Action<input className="field mt-1 min-h-10" name="auditAction" defaultValue={auditAction} maxLength={100} placeholder="Exact action" /></label>
          <label className="text-xs">Actor UUID<input className="field mt-1 min-h-10" name="actorId" defaultValue={auditActor} placeholder="Optional" /></label>
          <label className="text-xs">From<input className="field mt-1 min-h-10" name="from" type="datetime-local" defaultValue={auditFrom ? new Date(auditFrom).toISOString().slice(0,16) : ''} /></label>
          <label className="text-xs">To<input className="field mt-1 min-h-10" name="to" type="datetime-local" defaultValue={auditTo ? new Date(auditTo).toISOString().slice(0,16) : ''} /></label>
          <button className="btn sm:col-span-2 lg:col-span-4" type="submit" disabled={auditLoading}>{auditLoading ? 'Loading…' : 'Apply filters'}</button>
        </form>
        <div className="mt-4 max-h-96 divide-y divide-edge overflow-auto">{auditEntries.map(entry => <article key={entry.id} className="py-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{entry.action} <span className="ml-1 font-normal text-slate-400">{entry.resourceType}{entry.resourceId ? ` · ${entry.resourceId}` : ''}</span></p><time className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</time></div>
          <p className="mt-1 text-xs text-slate-500">Actor: {entry.actorId ?? 'System'}</p>
          {Object.keys(entry.metadata).length > 0 && <pre className="mt-1 overflow-x-auto text-[11px] text-slate-400">{JSON.stringify(entry.metadata)}</pre>}
        </article>)}{!auditEntries.length && <p className="py-3 text-sm text-slate-400">No matching audit entries.</p>}</div>
        {auditCursor && <button className="btn mt-3" type="button" onClick={loadMoreAudit} disabled={auditLoading}>{auditLoading ? 'Loading…' : 'Load more'}</button>}
      </section>
  </AdminPage>
}
