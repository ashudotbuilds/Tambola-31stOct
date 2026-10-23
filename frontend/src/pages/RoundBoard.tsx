import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { io } from 'socket.io-client'
import { getPublicRound } from '@/lib/api'
import { API_URL } from '@/lib/config'

type DisplayState = Awaited<ReturnType<typeof getPublicRound>>

export default function RoundBoard() {
  const { roundId = '' } = useParams()
  const [state, setState] = useState<DisplayState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState('connecting')
  const refresh = useCallback(async () => {
    try { setState(await getPublicRound(roundId)); setError(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load live round') }
  }, [roundId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!roundId) return
    let failures = 0
    const socket = io(API_URL, { withCredentials: true, auth: { publicRoundId: roundId }, reconnection: true, reconnectionAttempts: 6, reconnectionDelay: 500, reconnectionDelayMax: 5000 })
    socket.on('connect', () => { failures = 0; setConnection('connected'); void refresh() })
    socket.on('round_changed', () => { void refresh() })
    socket.on('disconnect', () => setConnection('reconnecting'))
    socket.on('connect_error', () => { failures++; setConnection(failures >= 6 ? 'offline · refreshing periodically' : 'reconnecting') })
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 15_000)
    return () => { window.clearInterval(timer); socket.disconnect() }
  }, [roundId, refresh])

  if (error && !state) return <main className="grid min-h-dvh place-items-center bg-slate-950 p-6 text-center text-white"><div><p role="alert">{error}</p><Link className="mt-4 inline-block text-cyan-300" to="/">Return home</Link></div></main>
  if (!state) return <main className="grid min-h-dvh place-items-center bg-slate-950 text-white" role="status">Connecting to live round…</main>

  const latest = state.draws.at(-1)
  return <main className="flex min-h-dvh flex-col overflow-hidden bg-[#07111f] px-5 py-4 text-white sm:px-8 sm:py-6 lg:px-12">
    <header className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
      <div><p className="text-sm font-semibold uppercase tracking-[0.35em] text-cyan-300">Technical Tambola · {state.event.name}</p><h1 className="mt-2 text-2xl font-black sm:text-4xl">Round {state.round.number} · {state.round.name}</h1></div>
      <div className="text-right"><p className="text-sm font-bold uppercase tracking-wider text-emerald-300">{state.round.status}</p><p className="mt-1 text-xs text-slate-400">{connection}</p></div>
    </header>
    <div className="grid flex-1 content-center gap-5 py-5 lg:grid-cols-[1.35fr_0.65fr] lg:gap-8">
      <section className="flex min-h-[38vh] flex-col items-center justify-center rounded-3xl border border-cyan-400/20 bg-slate-900/70 p-6 text-center shadow-2xl sm:min-h-[48vh] sm:p-10">
        {latest ? <>
          <p className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Question {latest.seq} of 90</p>
          {latest.revealed_at ? <>
            <p className="mt-6 max-w-5xl whitespace-pre-wrap text-2xl font-semibold leading-relaxed sm:text-4xl">{latest.question}</p>
            <div className="mt-7 rounded-2xl border-2 border-emerald-400/50 bg-emerald-400/10 px-7 py-4"><p className="text-xs uppercase tracking-widest text-emerald-300">Revealed key</p><p className="mt-1 text-3xl font-black text-emerald-200 sm:text-5xl">{latest.key}</p></div>
          </> : <div className="mt-8"><p className="text-2xl font-semibold text-slate-300 sm:text-4xl">The host is preparing the question</p><p className="mt-3 text-sm text-slate-500">The answer will appear here when revealed.</p></div>}
        </> : <><p className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">Live round</p><p className="mt-5 text-3xl font-bold sm:text-5xl">Waiting for the first question</p></>}
      </section>
      <aside className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 sm:p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">Draw history</h2><span className="font-mono text-cyan-300">{state.draws.length}</span></div><ol className="mt-3 max-h-[26vh] space-y-2 overflow-auto pr-1 lg:max-h-[28vh]">{state.draws.slice().reverse().map(draw => <li key={draw.seq} className="flex items-start gap-3 rounded-lg bg-white/5 p-2.5"><span className="min-w-9 font-mono text-xs text-cyan-300">#{draw.seq}</span><div className="min-w-0"><p className="truncate text-sm font-semibold">{draw.revealed_at ? draw.key : 'Awaiting reveal'}</p>{draw.revealed_at && <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{draw.question}</p>}</div></li>)}</ol></section>
        <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 sm:p-5"><h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">Verified winners</h2><div className="mt-3 space-y-2">{state.winners.map((winner, index) => <p key={`${winner.name}-${winner.pattern}-${index}`} className="rounded-lg border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-sm"><span className="font-semibold text-amber-100">{winner.name}</span><span className="ml-2 text-amber-300">· {winner.pattern.replaceAll('_',' ')} · {winner.points} pts</span></p>)}{!state.winners.length && <p className="text-sm text-slate-500">Winners will appear here after verification.</p>}</div></section>
        <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 sm:p-5"><h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">Standings</h2><ol className="mt-3 space-y-2">{state.standings.slice(0,10).map((entry,index) => <li key={`${entry.name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm"><span><span className="mr-2 font-mono text-cyan-300">{index + 1}.</span>{entry.name}<span className="ml-2 text-xs text-slate-500">{entry.wrong_claims} incorrect</span></span><strong className="text-amber-200">{entry.score}</strong></li>)}</ol>{!state.standings.length && <p className="mt-3 text-sm text-slate-500">Scores will appear after the first verified claim.</p>}</section>
      </aside>
    </div>
    <footer className="flex justify-between border-t border-white/10 pt-3 text-xs text-slate-500"><span>Official live display</span><span>{error ? 'Connection issue · refreshing from server' : 'Updates automatically'}</span></footer>
  </main>
}
