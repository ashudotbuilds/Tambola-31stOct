import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listAccountGames, resumeAccountGame } from '@/lib/api'

export function AdminGames({ games, loading, refresh }: {
  games: Awaited<ReturnType<typeof listAccountGames>>['games']; loading: boolean; refresh: () => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function manage(id: string) {
    setBusy(true)
    setError(null)
    try { await resumeAccountGame(id); navigate('/host') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore game') }
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
      <div className="flex flex-wrap gap-2"><Link className="btn" to={`/board?code=${encodeURIComponent(game.code)}`}>View game</Link>{game.can_manage && <button className="btn" disabled={busy} onClick={() => void manage(game.id)}>Manage game</button>}</div>
    </div>)}
  </section>
}
