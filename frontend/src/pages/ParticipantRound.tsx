import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import { getCurrentUser, getMyRound, markMyCell, submitMyClaim, type ParticipantRoundState } from '@/lib/api'
import { API_URL } from '@/lib/config'

export default function ParticipantRound() {
  const { roundId = '' } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState<ParticipantRoundState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<'connecting'|'connected'|'reconnecting'|'disconnected'>('connecting')
  const [busyCell, setBusyCell] = useState<string | null>(null)
  const [claimBusy, setClaimBusy] = useState(false)

  const refresh = useCallback(async () => {
    try { const next = await getMyRound(roundId); setState(next); setError(null) }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not refresh your ticket'
      setError(message)
      if (/authentication|session is invalid|expired/i.test(message)) navigate('/login', { replace: true })
    }
  }, [roundId, navigate])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!roundId) return
    let retries = 0
    const socket: Socket = io(API_URL, { withCredentials: true, auth: { roundId }, reconnection: true, reconnectionAttempts: 6, reconnectionDelay: 500, reconnectionDelayMax: 5000 })
    socket.on('connect', () => { retries = 0; setConnection('connected'); void refresh() })
    socket.on('round_changed', () => { void refresh() })
    socket.on('disconnect', () => setConnection('reconnecting'))
    socket.on('connect_error', () => { retries++; setConnection(retries >= 6 ? 'disconnected' : 'reconnecting') })
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 15_000)
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visible); socket.disconnect() }
  }, [roundId, refresh])

  async function toggleCell(keyId: string) {
    if (!state || busyCell || state.round.status !== 'ACTIVE') return
    const previous = state.ticket.marked_cell_ids
    const marked = !previous.includes(keyId)
    setBusyCell(keyId)
    setState(current => current ? { ...current, ticket: { ...current.ticket, marked_cell_ids: marked ? [...current.ticket.marked_cell_ids, keyId] : current.ticket.marked_cell_ids.filter(id => id !== keyId) } } : current)
    try {
      const result = await markMyCell(roundId, keyId, marked)
      setState(current => current ? { ...current, ticket: { ...current.ticket, marked_cell_ids: result.marked_cell_ids } } : current)
      setError(null)
    } catch (cause) {
      setState(current => current ? { ...current, ticket: { ...current.ticket, marked_cell_ids: previous } } : current)
      setError(cause instanceof Error ? cause.message : 'The mark was not saved')
    } finally { setBusyCell(null) }
  }

  async function claim(pattern: string) {
    if (!window.confirm(`Submit a ${pattern.replaceAll('_',' ')} claim for verification?`)) return
    setClaimBusy(true); setError(null)
    try { await submitMyClaim(roundId, pattern); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not submit claim') }
    finally { setClaimBusy(false) }
  }

  if (!state && !error) return <main className="mx-auto max-w-3xl px-4 py-12" role="status">Loading your ticket…</main>
  if (!state) return <main className="mx-auto max-w-3xl px-4 py-12"><p role="alert" className="card p-4 text-sm text-rose">{error}</p><Link className="btn mt-4" to="/account">Back to rounds</Link></main>

  const marked = new Set(state.ticket.marked_cell_ids)
  const cut = new Set(state.ticket.cut_cell_ids)
  const revealedKeys = new Set(state.draws.filter(draw => draw.revealed_at).map(draw => draw.key))
  const canMark = state.round.status === 'ACTIVE'
  return <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 px-3 py-5 sm:px-5 sm:py-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><Link className="text-xs text-cyan hover:underline" to="/account">← {state.event.name}</Link><h1 className="mt-1 text-2xl font-black sm:text-3xl">Round {state.round.number} · {state.round.name}</h1></div><span className="rounded-full border border-edge px-3 py-1 text-xs">{state.round.status} · {connection}</span></header>
    {error && <p role="alert" className="rounded-xl border border-rose/50 bg-rose/10 px-4 py-3 text-sm text-rose">{error}</p>}
    <section className="card p-3 sm:p-5" aria-label="Your Tambola ticket">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Your ticket · tap a revealed key to mark</h2>
      <p className="mb-2 text-xs text-slate-400 sm:hidden">Swipe horizontally to view all 9 columns.</p>
      <div className="overflow-x-auto"><div className="grid min-w-[620px] grid-cols-9 gap-1.5 sm:min-w-0 sm:gap-2">{state.ticket.cells.flatMap((row, rowIndex) => row.map((cell, columnIndex) => cell
        ? <button key={`${rowIndex}-${columnIndex}`} type="button" aria-pressed={marked.has(cell.id)} data-cut={cut.has(cell.id)} aria-label={`${cell.value}${cut.has(cell.id) ? ', cut' : marked.has(cell.id) ? ', marked' : ''}`} disabled={!canMark || !!busyCell || cut.has(cell.id) || (!marked.has(cell.id) && !revealedKeys.has(cell.value))} onClick={() => void toggleCell(cell.id)} className={`round-ticket-cell flex min-h-14 items-center justify-center rounded-md border px-1 text-center text-xs font-bold leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan sm:min-h-16 ${cut.has(cell.id) ? 'border-rose/70 bg-rose/15 text-rose line-through' : marked.has(cell.id) ? 'border-cyan bg-cyan/20 text-cyan ring-2 ring-cyan/30' : revealedKeys.has(cell.value) ? 'border-edge bg-panel text-slate-100 hover:border-cyan' : 'border-edge/60 bg-ink/30 text-slate-500'}`}>
          <span className="min-w-0 break-words">{cell.value}{cut.has(cell.id) ? ' · cut' : ''}</span>
        </button>
        : <div key={`${rowIndex}-${columnIndex}`} aria-hidden="true" className="min-h-12 rounded-md border border-dashed border-edge/30 sm:min-h-16" />))}</div></div>
      <p className="mt-3 text-xs text-slate-400">{marked.size} marked · {cut.size} cut · {revealedKeys.size} revealed keys</p>
    </section>
    <section className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4" aria-label="Your score"><p className="text-sm">Score <strong className="ml-1 text-cyan">{state.score.score}</strong></p><p className="text-sm">Incorrect claims <strong className="ml-1">{state.score.wrong_claims}</strong></p></section>
    <section className="card p-4 sm:p-5"><h2 className="text-lg font-bold">Draw history</h2><ol className="mt-3 grid gap-2 sm:grid-cols-2">{state.draws.slice().reverse().map(draw => <li key={draw.seq} className="rounded-lg border border-edge p-3 text-sm"><span className="mr-2 font-mono text-cyan">#{draw.seq}</span>{draw.revealed_at ? <><strong>{draw.key}</strong><p className="mt-1 whitespace-pre-wrap text-xs text-slate-400">{draw.question}</p></> : <span className="text-slate-400">Question waiting for host reveal</span>}</li>)}</ol>{!state.draws.length && <p className="mt-2 text-sm text-slate-400">No questions have been drawn.</p>}</section>
    <section className="card p-4 sm:p-5"><h2 className="text-lg font-bold">Claims</h2><div className="mt-3 flex flex-wrap gap-2">{state.patterns.filter(pattern => pattern.enabled && pattern.status === 'OPEN').map(pattern => {
      const existing = state.claims.find(claim => claim.pattern === pattern.pattern)
      return <button key={pattern.pattern} type="button" className="btn min-h-11 px-3 text-xs capitalize" disabled={!canMark || claimBusy || !!existing} onClick={() => void claim(pattern.pattern)}>{existing ? `${pattern.pattern.replaceAll('_',' ')} · ${existing.status.replaceAll('_',' ')}` : `Claim ${pattern.pattern.replaceAll('_',' ')}`}</button>
    })}</div><div className="mt-3 space-y-2">{state.claims.map((claim, index) => <p key={`${claim.pattern}-${index}`} className="rounded-lg bg-ink/20 p-3 text-sm">{claim.pattern.replaceAll('_',' ')} · {claim.status.replaceAll('_',' ')}{claim.points > 0 ? ` · +${claim.points} points` : ''}{claim.penalty > 0 ? ` · −${claim.penalty} points${claim.cut_cell_id ? ' · a marked key was cut' : ''}` : ''}{claim.reason ? ` · ${claim.reason}` : ''}</p>)}</div></section>
    {state.winners.length > 0 && <section className="card border-emerald-500/40 p-4"><h2 className="text-lg font-bold text-emerald-500">Verified winners</h2>{state.winners.map((winner, index) => <p key={`${winner.name}-${index}`} className="mt-2 text-sm">{winner.name} · {winner.pattern.replaceAll('_',' ')}</p>)}</section>}
  </main>
}
