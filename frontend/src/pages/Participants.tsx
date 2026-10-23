import { useEffect, useState, type FormEvent } from 'react'
import { AdminPage, useAdminAccount } from '@/components/AdminNavigation'
import { importParticipants, issueParticipantCredential, listParticipants, type Participant, type ParticipantImportResult } from '@/lib/api'

export default function Participants() {
  const { account, error } = useAdminAccount()
  const [adminBusy, setAdminBusy] = useState(false)
  const [participantError, setParticipantError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [importResult, setImportResult] = useState<ParticipantImportResult | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    listParticipants().then(result => { if (active) setParticipants(result.participants) })
      .catch(cause => { if (active) setParticipantError(cause instanceof Error ? cause.message : 'Could not load participants') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  async function uploadParticipants(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const file = (new FormData(form).get('participantsFile'))
    if (!(file instanceof File) || !file.size) { setParticipantError('Choose a CSV file first.'); return }
    setAdminBusy(true)
    setParticipantError(null)
    setImportResult(null)
    try {
      const csv = await file.text()
      const response = await importParticipants(csv)
      setImportResult(response)
      const participantResponse = await listParticipants()
      setParticipants(participantResponse.participants)
    } catch (cause) {
      setParticipantError(cause instanceof Error ? cause.message : 'Could not import participants')
    } finally { setAdminBusy(false) }
  }

  async function issueCredentials(participant: Participant) {
    if (!window.confirm(`Generate a new temporary password and send it to ${participant.email}? Any current participant session will be signed out.`)) return
    setAdminBusy(true); setParticipantError(null)
    try {
      await issueParticipantCredential(participant.profile_id)
      setParticipants((await listParticipants()).participants)
    } catch (cause) { setParticipantError(cause instanceof Error ? cause.message : 'Credential delivery failed') }
    finally { setAdminBusy(false) }
  }

  return <AdminPage account={account} error={error} title="Participants" description="Import players and send their sign-in credentials. They join a game using its code.">
    <p className="text-sm text-slate-400">Upload a CSV with name,email headers and optional external_id.</p>
    {loading && <p role="status">Loading participants…</p>}
    {participantError && <p role="alert" className="card p-4 text-rose">{participantError}</p>}
        <form className="mt-5 flex flex-col gap-3 rounded-xl border border-edge p-4 sm:flex-row sm:items-end" onSubmit={uploadParticipants}>
          <label className="min-w-48 flex-1 text-sm">Participant CSV<input className="field mt-1" type="file" name="participantsFile" accept=".csv,text/csv" required /></label>
          <button className="btn" type="submit" disabled={adminBusy}>{adminBusy ? 'Importing…' : 'Import participants'}</button>
        </form>
        <section className="mt-4 rounded-xl border border-edge p-4">
          <h3 className="font-semibold">Participants · {participants.length}</h3>
          <div className="mt-3 max-h-80 divide-y divide-edge overflow-auto">{participants.map(participant => <div key={participant.profile_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div className="min-w-48"><p className="font-semibold">{participant.name} <span className="ml-1 text-xs text-slate-400">{participant.account_status}</span></p><p className="text-xs text-slate-400">{participant.email}{participant.external_id ? ` · ${participant.external_id}` : ''}</p><p className="mt-1 text-[11px] text-slate-500">Credentials: {participant.credential_status.replaceAll('_',' ').toLowerCase()}{participant.last_sent_at ? ` · sent ${new Date(participant.last_sent_at).toLocaleString()}` : ''}</p></div>
            <button className="btn min-h-9 px-3 text-xs" type="button" disabled={adminBusy} onClick={() => issueCredentials(participant)}>{participant.credential_status === 'SENT' ? 'Regenerate & email' : 'Issue & email credentials'}</button>
          </div>)}{!participants.length && <p className="py-3 text-sm text-slate-400">No participants imported yet.</p>}</div>
        </section>
        {importResult && <div className="mt-4 rounded-xl border border-edge p-4" aria-live="polite">
          <p className="text-sm font-semibold">Import finished: {importResult.created} created, {importResult.skipped} skipped, {importResult.failed} failed.</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-slate-400">{importResult.rows.filter(row => row.status !== 'created').map(row => <li key={row.row}>Row {row.row}: {row.status}{row.message ? ` — ${row.message}` : ''}</li>)}</ul>
          <p className="mt-2 text-xs text-slate-400">Imported accounts are inactive until credential delivery is configured.</p>
        </div>}
  </AdminPage>
}
