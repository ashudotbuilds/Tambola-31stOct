import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addEventKey, addRoundQuestion, changeRoundStatus, createAdminAccount, createEvent, createRound, deleteAdminAccount, drawRoundQuestion, generateRoundTickets, getAdminDashboard, getAdminRoundState, getCurrentUser, getSystemDiagnostics, importParticipants, issueParticipantCredential, listAdminAccounts, listAudit, listEventKeys, listEventParticipants, listEvents, listRoundQuestions, listRounds, logoutUser, recoverRound, regenerateAdminCredential, revealRoundDraw, reviewRoundClaim, setRoundPattern, type AdminAccount, type AdminDashboard, type AdminEvent, type AdminRound, type AdminRoundState, type AuditEntry, type EventKey, type EventParticipant, type ParticipantImportResult, type RoundQuestion } from '@/lib/api'
import type { AuthMeResult } from '@/shared/types'
import { createGame,listAccountGames,resumeAccountGame } from '@/lib/api'

export default function Admin() {
  const navigate = useNavigate()
  const [account, setAccount] = useState<AuthMeResult | null>(null)
  const [accountGames,setAccountGames]=useState<Awaited<ReturnType<typeof listAccountGames>>['games']>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [admins, setAdmins] = useState<AdminAccount[]>([])
  const [adminError, setAdminError] = useState<string | null>(null)
  const [adminBusy, setAdminBusy] = useState(false)
  const [events, setEvents] = useState<AdminEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState('')
  const [eventError, setEventError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ParticipantImportResult | null>(null)
  const [rounds, setRounds] = useState<AdminRound[]>([])
  const [selectedRound, setSelectedRound] = useState('')
  const [keys, setKeys] = useState<EventKey[]>([])
  const [participants, setParticipants] = useState<EventParticipant[]>([])
  const [questions, setQuestions] = useState<RoundQuestion[]>([])
  const [roundState, setRoundState] = useState<AdminRoundState | null>(null)
  const [manualKeyId, setManualKeyId] = useState('')
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditCursor, setAuditCursor] = useState<string | null>(null)
  const [auditAction, setAuditAction] = useState('')
  const [auditActor, setAuditActor] = useState('')
  const [auditFrom, setAuditFrom] = useState('')
  const [auditTo, setAuditTo] = useState('')
  const [auditLoading, setAuditLoading] = useState(false)
  const [system, setSystem] = useState<Awaited<ReturnType<typeof getSystemDiagnostics>> | null>(null)

  useEffect(() => {
    let active = true
    getCurrentUser().then(async result => {
      if (!active) return
      if (result.principal.type === 'PARTICIPANT') {
        navigate('/account', { replace: true })
        return
      }
      setAccount(result)
      setAccountGames((await listAccountGames()).games)
      if (result.principal.type === 'SUPER_ADMIN') {
        const response = await listAdminAccounts()
        if (active) setAdmins(response.admins)
      }
      const response = await listEvents()
      if (active) {
        setEvents(response.events)
        setSelectedEvent(response.events[0]?.id ?? '')
      }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load your session')
    }).finally(() => {
      if (active) setBusy(false)
    })
    return () => { active = false }
  }, [navigate])

  useEffect(() => {
    if (!account || account.principal.type === 'PARTICIPANT') return
    let active = true
    getAdminDashboard().then(result => { if (active) setDashboard(result) })
      .catch(cause => { if (active) setDashboardError(cause instanceof Error ? cause.message : 'Dashboard is unavailable') })
    listAudit({ limit: 20 }).then(result => { if (active) { setAuditEntries(result.entries); setAuditCursor(result.nextCursor) } })
      .catch(cause => { if (active) setAdminError(cause instanceof Error ? cause.message : 'Audit log is unavailable') })
    if (account.principal.type === 'SUPER_ADMIN') getSystemDiagnostics().then(result => { if (active) setSystem(result) })
      .catch(() => { if (active) setSystem(null) })
    return () => { active = false }
  }, [account])

  useEffect(() => {
    if (!selectedEvent || account?.principal.type === 'PARTICIPANT') return
    let active = true
    Promise.all([listRounds(selectedEvent), listEventKeys(selectedEvent), listEventParticipants(selectedEvent)]).then(([roundResponse, keyResponse, participantResponse]) => {
      if (!active) return
      setRounds(roundResponse.rounds)
      setKeys(keyResponse.keys)
      setParticipants(participantResponse.participants)
      setSelectedRound(current => roundResponse.rounds.some(round => round.id === current) ? current : roundResponse.rounds[0]?.id ?? '')
    }).catch(cause => setEventError(cause instanceof Error ? cause.message : 'Could not load event setup'))
    return () => { active = false }
  }, [selectedEvent, account?.principal.type])

  useEffect(() => {
    if (!selectedRound) { setQuestions([]); setRoundState(null); return }
    let active = true
    Promise.all([listRoundQuestions(selectedRound), getAdminRoundState(selectedRound)]).then(([response, state]) => {
      if (active) { setQuestions(response.questions); setRoundState(state) }
    })
      .catch(cause => setEventError(cause instanceof Error ? cause.message : 'Could not load questions'))
    return () => { active = false }
  }, [selectedRound])

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

  async function addAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setAdminBusy(true)
    setAdminError(null)
    try {
      await createAdminAccount({
        email: String(data.get('email') ?? ''),
        name: String(data.get('name') ?? ''),
        role: String(data.get('role')) === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN',
      })
      form.reset()
      const response = await listAdminAccounts()
      setAdmins(response.admins)
    } catch (cause) {
      setAdminError(cause instanceof Error ? cause.message : 'Could not create administrator')
      try { setAdmins((await listAdminAccounts()).admins) } catch { /* Keep the original delivery or create error visible. */ }
    } finally {
      setAdminBusy(false)
    }
  }

  async function removeAdmin(profileId: string) {
    if (!window.confirm('Remove this administrator account? Their active sessions will stop working.')) return
    setAdminBusy(true)
    setAdminError(null)
    try {
      await deleteAdminAccount(profileId)
      setAdmins(current => current.filter(admin => admin.id !== profileId))
    } catch (cause) {
      setAdminError(cause instanceof Error ? cause.message : 'Could not remove administrator')
    } finally {
      setAdminBusy(false)
    }
  }

  async function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setAdminBusy(true)
    setEventError(null)
    try {
      const response = await createEvent({ name: String(data.get('eventName') ?? ''), description: String(data.get('eventDescription') ?? '') })
      setEvents(current => [response.event, ...current])
      setSelectedEvent(response.event.id)
      form.reset()
    } catch (cause) {
      setEventError(cause instanceof Error ? cause.message : 'Could not create event')
    } finally { setAdminBusy(false) }
  }

  async function uploadParticipants(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedEvent) return
    const form = event.currentTarget
    const file = (new FormData(form).get('participantsFile'))
    if (!(file instanceof File) || !file.size) { setEventError('Choose a CSV file first.'); return }
    setAdminBusy(true)
    setEventError(null)
    setImportResult(null)
    try {
      const csv = await file.text()
      const response = await importParticipants(selectedEvent, csv)
      setImportResult(response)
      const [refreshed, participantResponse] = await Promise.all([listEvents(), listEventParticipants(selectedEvent)])
      setEvents(refreshed.events)
      setParticipants(participantResponse.participants)
    } catch (cause) {
      setEventError(cause instanceof Error ? cause.message : 'Could not import participants')
    } finally { setAdminBusy(false) }
  }

  async function addRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedEvent) return
    const form = event.currentTarget
    const name = String(new FormData(form).get('roundName') ?? '')
    setAdminBusy(true); setEventError(null)
    try {
      const response = await createRound(selectedEvent, name)
      const refreshed = await listRounds(selectedEvent)
      setRounds(refreshed.rounds)
      setSelectedRound(response.round.id)
      form.reset()
    } catch (cause) { setEventError(cause instanceof Error ? cause.message : 'Could not create round') }
    finally { setAdminBusy(false) }
  }

  async function addKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedEvent) return
    const form = event.currentTarget
    const value = String(new FormData(form).get('keyValue') ?? '')
    setAdminBusy(true); setEventError(null)
    try {
      await addEventKey(selectedEvent, value)
      setKeys((await listEventKeys(selectedEvent)).keys)
      form.reset()
    } catch (cause) { setEventError(cause instanceof Error ? cause.message : 'Could not add key') }
    finally { setAdminBusy(false) }
  }

  async function addQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedRound) return
    const form = event.currentTarget
    const data = new FormData(form)
    setAdminBusy(true); setEventError(null)
    try {
      await addRoundQuestion(selectedRound, String(data.get('keyId') ?? ''), String(data.get('question') ?? ''))
      setQuestions((await listRoundQuestions(selectedRound)).questions)
      setRounds((await listRounds(selectedEvent)).rounds)
      form.reset()
    } catch (cause) { setEventError(cause instanceof Error ? cause.message : 'Could not add question') }
    finally { setAdminBusy(false) }
  }

  async function runRoundAction(round: AdminRound, action: 'ready'|'start'|'pause'|'resume'|'complete'|'cancel') {
    const prompts: Partial<Record<typeof action, string>> = {
      start: `Start ${round.name}? Tickets and question content will become immutable.`,
      complete: `Complete ${round.name}? This ends the round.`,
      cancel: `Cancel ${round.name}? This cannot be undone.`,
    }
    if (prompts[action] && !window.confirm(prompts[action])) return
    setAdminBusy(true); setEventError(null)
    try {
      await changeRoundStatus(round.id, action)
      setRounds((await listRounds(selectedEvent)).rounds)
      setEvents((await listEvents()).events)
    } catch (cause) { setEventError(cause instanceof Error ? cause.message : `Could not ${action} round`) }
    finally { setAdminBusy(false) }
  }

  async function generateTickets(round: AdminRound) {
    setAdminBusy(true); setEventError(null)
    try {
      const result = await generateRoundTickets(round.id)
      setEventError(`Assigned ${result.created} new ticket${result.created === 1 ? '' : 's'}; ${result.total} participant${result.total === 1 ? '' : 's'} in this event.`)
      setRounds((await listRounds(selectedEvent)).rounds)
    } catch (cause) { setEventError(cause instanceof Error ? cause.message : 'Could not generate tickets') }
    finally { setAdminBusy(false) }
  }

  async function savePattern(round: AdminRound, pattern: string, enabled: boolean, maxWinners: number) {
    setAdminBusy(true); setEventError(null)
    try {
      await setRoundPattern(round.id, pattern, enabled, maxWinners)
      setRounds((await listRounds(selectedEvent)).rounds)
    } catch (cause) { setEventError(cause instanceof Error ? cause.message : 'Could not update pattern') }
    finally { setAdminBusy(false) }
  }

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

  async function issueCredentials(participant: EventParticipant) {
    if (!window.confirm(`Generate a new temporary password and send it to ${participant.email}? Any current participant session will be signed out.`)) return
    setAdminBusy(true); setEventError(null)
    try {
      await issueParticipantCredential(selectedEvent, participant.profile_id)
      setParticipants((await listEventParticipants(selectedEvent)).participants)
    } catch (cause) { setEventError(cause instanceof Error ? cause.message : 'Credential delivery failed') }
    finally { setAdminBusy(false) }
  }

  async function refreshRoundState(roundId = selectedRound) {
    if (!roundId) return
    const state = await getAdminRoundState(roundId)
    setRoundState(state)
  }

  async function drawNext(round: AdminRound, keyId?: string) {
    setAdminBusy(true); setEventError(null)
    try {
      await drawRoundQuestion(round.id, keyId)
      await refreshRoundState(round.id)
    } catch (cause) { setEventError(cause instanceof Error ? cause.message : 'Could not draw the next question') }
    finally { setAdminBusy(false) }
  }

  async function revealDraw(round: AdminRound, seq: number) {
    setAdminBusy(true); setEventError(null)
    try { await revealRoundDraw(round.id, seq); await refreshRoundState(round.id) }
    catch (cause) { setEventError(cause instanceof Error ? cause.message : 'Could not reveal this question') }
    finally { setAdminBusy(false) }
  }

  async function reviewClaim(round: AdminRound, claimId: string, decision: 'verify'|'reject') {
    const action = decision === 'verify' ? 'verify this winner' : 'reject this claim'
    if (!window.confirm(`Are you sure you want to ${action}?`)) return
    setAdminBusy(true); setEventError(null)
    try { await reviewRoundClaim(claimId, decision); await refreshRoundState(round.id) }
    catch (cause) { setEventError(cause instanceof Error ? cause.message : `Could not ${decision} claim`) }
    finally { setAdminBusy(false) }
  }

  async function handleRecovery(round: AdminRound) {
    if (!window.confirm(`Validate stored state for ${round.name} and move it to Paused so the Super Admin can resume it?`)) return
    setAdminBusy(true); setEventError(null)
    try {
      await recoverRound(round.id)
      setRounds((await listRounds(selectedEvent)).rounds)
      await refreshRoundState(round.id)
      setSystem(await getSystemDiagnostics())
    } catch (cause) { setEventError(cause instanceof Error ? cause.message : 'Round recovery failed') }
    finally { setAdminBusy(false) }
  }

  if (busy) return <main className="mx-auto max-w-4xl px-4 py-12" role="status">Loading account…</main>
  if (!account) return <main className="mx-auto max-w-md px-4 py-12"><p role="alert" className="card p-4 text-sm text-rose">{error ?? 'Sign in to continue.'}</p><Link className="btn btn-primary mt-4" to="/login">Go to sign in</Link></main>

  const role = account.principal.role ?? account.principal.type
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan">Technical Tambola</p><h1 className="mt-2 text-3xl font-black">Administration</h1></div>
        <button className="btn btn-primary" disabled={adminBusy} onClick={async()=>{setAdminBusy(true);try{await createGame(account.user.name);navigate('/host')}catch(cause){setError(cause instanceof Error?cause.message:'Could not create game')}finally{setAdminBusy(false)}}}>Create a game</button>
        <button className="btn" type="button" onClick={signOut} disabled={busy}>Sign out</button>
      </header>
      {error && <p role="alert" className="rounded-xl border border-rose/50 bg-rose/10 px-4 py-3 text-sm text-rose">{error}</p>}
      <section className="card p-5"><h2 className="text-lg font-bold">Games</h2>{accountGames.length===0&&<p className="mt-2 text-sm text-slate-400">Create your first game and share its code with members.</p>}{accountGames.map(game=><div key={game.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge p-3"><p><strong className="font-mono">{game.code}</strong><span className="ml-3 text-sm">{game.status}</span></p><button className="btn" disabled={adminBusy} onClick={async()=>{setAdminBusy(true);try{await resumeAccountGame(game.id);navigate('/host')}catch(cause){setError(cause instanceof Error?cause.message:'Could not restore game')}finally{setAdminBusy(false)}}}>Manage game</button></div>)}</section>
      {account.principal.type !== 'PARTICIPANT' && <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Operations dashboard</h2><button type="button" className="btn min-h-9 px-3 text-xs" onClick={async () => { try { setDashboard(await getAdminDashboard()); setDashboardError(null) } catch (cause) { setDashboardError(cause instanceof Error ? cause.message : 'Dashboard unavailable') } }}>Refresh</button></div>
        {dashboardError && <p role="alert" className="mt-3 text-sm text-rose">Dashboard unavailable: {dashboardError}</p>}
        {!dashboardError && dashboard && <>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm"><span>{dashboard.event ? `${dashboard.event.name} · ${dashboard.event.status}` : 'No live event'}</span><span>{dashboard.round ? `Round ${dashboard.round.round_no} · ${dashboard.round.name} · ${dashboard.round.status}` : 'No active round'}</span></div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[
            ['Participants', dashboard.counts.participants], ['Draws', dashboard.counts.draws], ['Pending claims', dashboard.counts.pendingClaims], ['Verified winners', dashboard.counts.verifiedWinners], ['Recovery required', dashboard.recoveryRequiredRounds], ['Connections', dashboard.socketConnections],
          ].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-edge p-3"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 text-xl font-bold">{value}</dd></div>)}</dl>
        </>}
      </section>}
      {account.principal.type === 'SUPER_ADMIN' && system && <section className="card p-5"><h2 className="text-lg font-bold">System diagnostics</h2><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">{[
        ['Application version', system.version ?? 'Unavailable'], ['Node runtime', system.nodeVersion], ['Readiness', system.readiness === null ? 'Unavailable' : system.readiness ? 'Ready' : 'Not ready'], ['Recovery required rounds', system.recoveryRequiredRounds ?? 'Unavailable'], ['Latest migration', system.latestMigration ?? 'Unavailable'],
      ].map(([label, value]) => <div key={String(label)}><dt className="text-slate-400">{label}</dt><dd>{value}</dd></div>)}</dl></section>}
      {account.principal.type !== 'PARTICIPANT' && <section className="card p-5">
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
      </section>}
      {account.principal.type === 'SUPER_ADMIN' && <section className="card p-5">
        <h2 className="text-lg font-bold">Administrator accounts</h2>
        <p className="mt-1 text-sm text-slate-400">The account stays inactive until its temporary password is delivered to the administrator by email.</p>
        {adminError && <p role="alert" className="mt-3 rounded-lg border border-rose/50 bg-rose/10 p-3 text-sm text-rose">{adminError}</p>}
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={addAdmin}>
          <label className="text-sm">Name<input className="field mt-1" name="name" required maxLength={100} /></label>
          <label className="text-sm">Email<input className="field mt-1" name="email" type="email" required maxLength={255} /></label>
          <label className="text-sm">Role<select className="field mt-1" name="role" defaultValue="ADMIN"><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super Admin</option></select></label>
          <button className="btn btn-primary sm:col-span-2" type="submit" disabled={adminBusy}>{adminBusy ? 'Saving…' : 'Create administrator'}</button>
        </form>
        <div className="mt-5 divide-y divide-edge">
          {admins.map(admin => <div key={admin.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div><p className="font-semibold">{admin.name} <span className="text-xs text-slate-400">{admin.role}</span></p><p className="text-slate-400">{admin.email}</p><p className="text-[11px] text-slate-500">Credentials: {admin.credential_status?.toLowerCase() ?? 'not issued'}{admin.credential_last_sent_at ? ` · sent ${new Date(admin.credential_last_sent_at).toLocaleString()}` : ''}</p></div>
            <div className="flex gap-2">{admin.credential_status !== 'PENDING' && <button type="button" className="btn min-h-9 px-3 text-xs" onClick={async () => {
              if (!window.confirm(`Generate and email a new password to ${admin.email}? Their existing sessions will end.`)) return
              setAdminBusy(true); setAdminError(null)
              try { await regenerateAdminCredential(admin.id); setAdmins((await listAdminAccounts()).admins) }
              catch (cause) { setAdminError(cause instanceof Error ? cause.message : 'Credential email failed') }
              finally { setAdminBusy(false) }
            }} disabled={adminBusy}>Regenerate credentials</button>}{admin.user_id !== account.user.id && <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => removeAdmin(admin.id)} disabled={adminBusy}>Remove</button>}</div>
          </div>)}
          {admins.length === 0 && <p className="py-3 text-sm text-slate-400">No administrator accounts yet.</p>}
        </div>
      </section>}
      {account.principal.type !== 'PARTICIPANT' && <section className="card p-5">
        <h2 className="text-lg font-bold">Events and participants</h2>
        <p className="mt-1 text-sm text-slate-400">Create an event, then import a CSV with <code>name,email</code> headers and optional <code>external_id</code>.</p>
        {eventError && <p role="alert" className="mt-3 rounded-lg border border-rose/50 bg-rose/10 p-3 text-sm text-rose">{eventError}</p>}
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={addEvent}>
          <label className="text-sm">Event name<input className="field mt-1" name="eventName" required maxLength={150} /></label>
          <label className="text-sm">Description<input className="field mt-1" name="eventDescription" maxLength={2000} /></label>
          <button className="btn btn-primary sm:col-span-2" type="submit" disabled={adminBusy}>{adminBusy ? 'Saving…' : 'Create event'}</button>
        </form>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm"><thead><tr className="border-b border-edge text-slate-400"><th className="py-2">Event</th><th>Status</th><th>Participants</th></tr></thead><tbody>
            {events.map(item => <tr key={item.id} className="border-b border-edge/60"><td className="py-3 font-medium">{item.name}</td><td>{item.status}</td><td>{item.participant_count}</td></tr>)}
            {!events.length && <tr><td colSpan={3} className="py-3 text-slate-400">No events created yet.</td></tr>}
          </tbody></table>
        </div>
        {events.length > 0 && <div className="mt-5 rounded-xl border border-edge p-4">
          <label className="block max-w-xl text-sm">Selected event<select className="field mt-1" value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)}>{events.map(item => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <form className="flex flex-col gap-3 rounded-lg bg-ink/20 p-3" onSubmit={addRound}>
              <h3 className="font-semibold">Sequential rounds</h3>
              <label className="text-sm">Round name<input className="field mt-1" name="roundName" required maxLength={150} placeholder="Round 1" /></label>
              <button className="btn" type="submit" disabled={adminBusy}>Add next round</button>
            </form>
            <form className="flex flex-col gap-3 rounded-lg bg-ink/20 p-3" onSubmit={addKey}>
              <h3 className="font-semibold">Event keys</h3>
              <label className="text-sm">Key or term<input className="field mt-1" name="keyValue" required minLength={2} maxLength={50} placeholder="e.g. Binary Search" /></label>
              <button className="btn" type="submit" disabled={adminBusy}>Add key</button>
              <p className="text-xs text-slate-400">{keys.length} key{keys.length === 1 ? '' : 's'} · values are normalized for duplicate checking.</p>
            </form>
          </div>
          {rounds.map(round => <article key={round.id} className="mt-4 rounded-xl border border-edge p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button type="button" className="text-left" onClick={() => setSelectedRound(round.id)} aria-pressed={selectedRound === round.id}>
                <span className="text-xs uppercase tracking-wider text-cyan">Round {round.round_no}</span><span className="ml-2 font-bold">{round.name}</span>
                <span className="ml-2 rounded bg-ink px-2 py-1 text-xs">{round.status}</span>
                <span className="mt-1 block text-xs text-slate-400">{round.question_count} questions · {round.ticket_count} tickets</span>
              </button>
              <div className="flex flex-wrap gap-2">
                {round.status === 'DRAFT' && <button className="btn min-h-9 px-3 text-xs" onClick={() => generateTickets(round)} disabled={adminBusy}>Assign tickets</button>}
                {round.status === 'DRAFT' && <button className="btn min-h-9 px-3 text-xs" onClick={() => runRoundAction(round, 'ready')} disabled={adminBusy}>Mark ready</button>}
                {round.status === 'READY' && <button className="btn btn-primary min-h-9 px-3 text-xs" onClick={() => runRoundAction(round, 'start')} disabled={adminBusy}>Start</button>}
                {round.status === 'ACTIVE' && <button className="btn min-h-9 px-3 text-xs" onClick={() => runRoundAction(round, 'pause')} disabled={adminBusy}>Pause</button>}
                {round.status === 'PAUSED' && <button className="btn min-h-9 px-3 text-xs" onClick={() => runRoundAction(round, 'resume')} disabled={adminBusy}>Resume</button>}
                {round.status === 'RECOVERY_REQUIRED' && account.principal.type === 'SUPER_ADMIN' && <button className="btn btn-primary min-h-9 px-3 text-xs" onClick={() => handleRecovery(round)} disabled={adminBusy}>Validate & recover</button>}
                {['ACTIVE','PAUSED'].includes(round.status) && <button className="btn min-h-9 px-3 text-xs" onClick={() => runRoundAction(round, 'complete')} disabled={adminBusy}>Complete round</button>}
                {['DRAFT','READY'].includes(round.status) && <button className="btn min-h-9 px-3 text-xs" onClick={() => runRoundAction(round, 'cancel')} disabled={adminBusy}>Cancel</button>}
              </div>
            </div>
            {selectedRound === round.id && <>
              {round.status === 'RECOVERY_REQUIRED' && <div className="mt-4 rounded-lg border border-amber/50 bg-amber/10 p-3 text-sm" role="status">
                <p className="font-semibold">Round recovery required · {roundState?.recovery?.validation_status ?? 'PENDING'}</p>
                <p className="mt-1 text-xs text-slate-300">The server paused this round after restart. A Super Admin must validate it before resuming.</p>
                {roundState?.recovery?.validation_issues?.length ? <ul className="mt-2 list-disc pl-5 text-xs text-amber">{roundState.recovery.validation_issues.map(issue => <li key={issue}>{issue.replaceAll('_',' ').toLowerCase()}</li>)}</ul> : null}
              </div>}
              <form className="mt-4 grid gap-3 rounded-lg bg-ink/20 p-3 md:grid-cols-[minmax(0,1fr)_2fr_auto] md:items-end" onSubmit={addQuestion}>
                <h3 className="font-semibold md:col-span-3">Question/key pairs</h3>
                <label className="text-sm">Key<select className="field mt-1" name="keyId" required>{keys.filter(key => key.active).map(key => <option key={key.id} value={key.id}>{key.value}</option>)}</select></label>
                <label className="text-sm">Question<input className="field mt-1" name="question" required maxLength={4000} /></label>
                <button className="btn" type="submit" disabled={adminBusy || !keys.length || !['DRAFT','READY'].includes(round.status)}>Add question</button>
              </form>
              <div className="mt-3 max-h-48 space-y-2 overflow-auto">{questions.map(question => <div key={question.id} className="rounded-lg bg-ink/20 p-3 text-sm"><strong>{question.key}</strong><p className="mt-1 whitespace-pre-wrap text-slate-300">{question.question}</p></div>)}{!questions.length && <p className="text-sm text-slate-400">No question/key pairs yet.</p>}</div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{round.patterns.map(pattern => <PatternControl key={pattern.pattern} round={round} pattern={pattern.pattern} enabled={pattern.enabled} maxWinners={pattern.max_winners} disabled={adminBusy || !['DRAFT','READY'].includes(round.status)} onSave={savePattern} />)}</div>
              {round.status === 'ACTIVE' && roundState && <section className="mt-4 rounded-xl border border-cyan/30 bg-cyan/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Live draw controls</h3><span className="text-xs text-slate-400">{roundState.draws.length} drawn · {roundState.pending_claims} pending claims</span></div>
                {roundState.draws.at(-1) && !roundState.draws.at(-1)?.revealed_at ? <div className="mt-3 rounded-lg bg-ink/30 p-3">
                  <p className="text-xs text-amber">Question {roundState.draws.at(-1)?.seq} · hidden from participants</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{roundState.draws.at(-1)?.question}</p>
                  <p className="mt-1 text-sm text-cyan">Answer: {roundState.draws.at(-1)?.key}</p>
                  <button className="btn btn-primary mt-3" type="button" disabled={adminBusy} onClick={() => revealDraw(round, roundState.draws.at(-1)!.seq)}>Reveal to participants</button>
                </div> : <div className="mt-3 flex flex-wrap items-end gap-3">
                  <button className="btn btn-primary" type="button" disabled={adminBusy} onClick={() => drawNext(round)}>Draw random question</button>
                  <label className="min-w-56 flex-1 text-sm">Manual draw<select className="field mt-1" value={manualKeyId} onChange={event => setManualKeyId(event.target.value)}><option value="">Choose an unused key</option>{questions.filter(question => question.active && !roundState.draws.some(draw => draw.key_id === question.key_id)).map(question => <option value={question.key_id} key={question.key_id}>{question.key}</option>)}</select></label>
                  <button className="btn" type="button" disabled={adminBusy || !manualKeyId} onClick={() => drawNext(round, manualKeyId)}>Draw selected key</button>
                </div>}
                <ol className="mt-3 grid gap-2 sm:grid-cols-2">{roundState.draws.slice().reverse().map(draw => <li key={draw.id ?? draw.seq} className="rounded-lg bg-ink/20 p-2 text-xs"><strong>#{draw.seq}</strong> {draw.key} {draw.manual && <span className="text-purple-300">· manual</span>}<p className="mt-1 text-slate-400">{draw.question}</p><span className={draw.revealed_at ? 'text-emerald-400' : 'text-amber'}>{draw.revealed_at ? 'Revealed' : 'Hidden'}</span></li>)}</ol>
              </section>}
              {roundState && <section className="mt-4 rounded-xl border border-edge p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Claims and winners</h3><Link className="text-xs text-cyan hover:underline" to={`/display/round/${round.id}`} target="_blank">Open projector display</Link></div>
                {roundState.claims.map(claim => <div key={claim.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ink/20 p-3 text-sm">
                  <div><p className="font-semibold">{claim.participant_name} · {claim.pattern.replaceAll('_',' ')}</p><p className="text-xs text-slate-400">{claim.status} · {claim.participant_email}{claim.points > 0 ? ` · +${claim.points} pts` : ''}{claim.penalty > 0 ? ` · −${claim.penalty} pts${claim.cut_cell_id ? ' · key cut' : ''}` : ''}</p>{claim.reason && <p className="text-xs text-rose">{claim.reason}</p>}</div>
                  {claim.status === 'PENDING_VERIFICATION' && <div className="flex gap-2"><button className="btn btn-primary min-h-9 px-3 text-xs" disabled={adminBusy} onClick={() => reviewClaim(round, claim.id, 'verify')}>Verify</button><button className="btn min-h-9 px-3 text-xs" disabled={adminBusy} onClick={() => reviewClaim(round, claim.id, 'reject')}>Reject</button></div>}
                </div>)}
                {!roundState.claims.length && <p className="mt-2 text-sm text-slate-400">No claims submitted.</p>}
              </section>}
            </>}
          </article>)}
          {!rounds.length && <p className="mt-4 text-sm text-slate-400">Create an event, import participants and add the first round.</p>}
        </div>}
        {events.length > 0 && <form className="mt-5 flex flex-col gap-3 rounded-xl border border-edge p-4 sm:flex-row sm:items-end" onSubmit={uploadParticipants}>
          <label className="min-w-48 flex-1 text-sm">Event<select className="field mt-1" value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)}>{events.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="min-w-48 flex-1 text-sm">Participant CSV<input className="field mt-1" type="file" name="participantsFile" accept=".csv,text/csv" required /></label>
          <button className="btn" type="submit" disabled={adminBusy}>{adminBusy ? 'Importing…' : 'Import participants'}</button>
        </form>}
        {selectedEvent && <section className="mt-4 rounded-xl border border-edge p-4">
          <h3 className="font-semibold">Participants · {participants.length}</h3>
          <div className="mt-3 max-h-80 divide-y divide-edge overflow-auto">{participants.map(participant => <div key={participant.profile_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div className="min-w-48"><p className="font-semibold">{participant.name} <span className="ml-1 text-xs text-slate-400">{participant.account_status}</span></p><p className="text-xs text-slate-400">{participant.email}{participant.external_id ? ` · ${participant.external_id}` : ''}</p><p className="mt-1 text-[11px] text-slate-500">Credentials: {participant.credential_status.replaceAll('_',' ').toLowerCase()}{participant.last_sent_at ? ` · sent ${new Date(participant.last_sent_at).toLocaleString()}` : ''}</p></div>
            <button className="btn min-h-9 px-3 text-xs" type="button" disabled={adminBusy} onClick={() => issueCredentials(participant)}>{participant.credential_status === 'SENT' ? 'Regenerate & email' : 'Issue & email credentials'}</button>
          </div>)}{!participants.length && <p className="py-3 text-sm text-slate-400">No participants imported yet.</p>}</div>
        </section>}
        {importResult && <div className="mt-4 rounded-xl border border-edge p-4" aria-live="polite">
          <p className="text-sm font-semibold">Import finished: {importResult.created} created, {importResult.skipped} skipped, {importResult.failed} failed.</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-slate-400">{importResult.rows.filter(row => row.status !== 'created').map(row => <li key={row.row}>Row {row.row}: {row.status}{row.message ? ` — ${row.message}` : ''}</li>)}</ul>
          <p className="mt-2 text-xs text-slate-400">Imported accounts are inactive until credential delivery is configured.</p>
        </div>}
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

function PatternControl(props: {
  round: AdminRound
  pattern: string
  enabled: boolean
  maxWinners: number
  disabled: boolean
  onSave: (round: AdminRound, pattern: string, enabled: boolean, maxWinners: number) => void
}) {
  const [enabled, setEnabled] = useState(props.enabled)
  const [maxWinners, setMaxWinners] = useState(props.maxWinners)
  useEffect(() => { setEnabled(props.enabled); setMaxWinners(props.maxWinners) }, [props.enabled, props.maxWinners])
  return <form className="rounded-lg border border-edge p-3" onSubmit={event => { event.preventDefault(); props.onSave(props.round, props.pattern, enabled, maxWinners) }}>
    <label className="flex items-center gap-2 text-sm font-semibold">
      <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={props.disabled} />
      {props.pattern.replaceAll('_', ' ')}
    </label>
    <label className="mt-2 block text-xs text-slate-400">Maximum winners
      <input className="field mt-1 min-h-9" type="number" min={1} max={500} value={maxWinners} onChange={event => setMaxWinners(Number(event.target.value))} disabled={props.disabled} />
    </label>
    <button className="btn mt-2 min-h-8 px-2 text-xs" type="submit" disabled={props.disabled}>Save</button>
  </form>
}
