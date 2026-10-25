import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { deleteAccountGame, listAccountGames, resumeAccountGame } from '@/lib/api'

export function AdminGames({ games, loading, refresh }: {
  games: Awaited<ReturnType<typeof listAccountGames>>['games']; loading: boolean; refresh: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<{ id: string; code: string } | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  async function manage(id: string) {
    setBusy(true)
    setError(null)
    try { await resumeAccountGame(id); navigate('/host') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore game') }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!deleting || confirmation !== deleting.code || busy) return
    setBusy(true); setError(null)
    try { await deleteAccountGame(deleting.id, confirmation); setDeleting(null); setConfirmation(''); refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete game') }
    finally { setBusy(false) }
  }
  return <section id="games" className="card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Games</h2><button className="btn" onClick={refresh}>Refresh games</button></div>
    <p className="mt-2 text-sm text-slate-400">Shared across administrators. Manage your games or view another host’s game.</p>
    {error && <p role="alert" className="mt-3 text-sm text-rose">{error}</p>}
    {loading && <p role="status" className="mt-3 text-sm">Loading games…</p>}
    {!loading && games.length === 0 && <p className="mt-3 text-sm text-slate-400">Create your first game and share its code with members.</p>}
    {games.map(game => <div key={game.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge p-3">
      <div className="min-w-0"><p><strong className="font-mono text-cyan">{game.code}</strong><span className="ml-3 text-sm">{game.status}</span></p><p className="mt-1 break-words text-xs text-slate-400">Host: {game.host_name}</p></div>
      <div className="flex flex-wrap gap-2"><Link className="btn" to={`/admin/audit?game=${game.id}`} state={{ backTo: location.pathname }}>Game audit</Link><Link className="btn" to={`/board?code=${encodeURIComponent(game.code)}`}>View game</Link>{game.can_manage && <button className="btn" disabled={busy} onClick={() => void manage(game.id)}>Manage game</button>}{game.can_manage && <button className="btn btn-danger" disabled={busy} onClick={() => { setDeleting({ id: game.id, code: game.code }); setConfirmation(''); setError(null) }}>Delete game</button>}</div>
    </div>)}
    {deleting && <form aria-label={`Delete game ${deleting.code}`} className="mt-4 rounded-lg border border-rose/70 bg-rose/10 p-4" onSubmit={event => { event.preventDefault(); void remove() }}>
      <h3 className="font-bold text-rose">Delete game {deleting.code}?</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">This ends access for everyone and removes the game from the games list. Its audit history is retained. You cannot undo this from the app.</p>
      <label className="mt-3 block text-sm">Type {deleting.code} to confirm<input autoFocus className="field mt-2 max-w-xs font-mono" value={confirmation} onChange={event => setConfirmation(event.target.value.toUpperCase())} autoComplete="off" maxLength={6} disabled={busy} /></label>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn" disabled={busy} onClick={() => setDeleting(null)}>Cancel</button><button className="btn btn-danger" disabled={busy || confirmation !== deleting.code}>{busy ? 'Deleting…' : 'Confirm delete'}</button><Link className="btn" to={`/admin/audit?game=${deleting.id}`} state={{ backTo: location.pathname }}>Review audit first</Link></div>
    </form>}
  </section>
}
