import { Link } from 'react-router-dom'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'

export function Results({
  players,
  state,
  customBank,
}: {
  players: { id: string; name: string; score: number; is_host: boolean; wrong_claims: number }[]
  state: { calls: { seq: number; number: number; clue: string }[] } | null
  customBank: TechnicalItem[] | null
}) {
  const podium = players.filter((p) => !p.is_host).slice(0, 3)
  const medals = ['🥇', '🥈', '🥉']

  return (
    <section className="card p-5 sm:p-6 mt-4">
      <h2 className="text-lg font-bold">Final standings</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {podium.map((p, i) => (
          <div
            key={p.id}
            className={`rounded-xl border p-4 text-center ${
              i === 0 ? 'border-amber/70 bg-amber/10' : 'border-edge bg-panel/60'
            }`}
          >
            <p className="text-3xl">{medals[i]}</p>
            <p className="mt-1 font-bold">{p.name}</p>
            <p className="text-2xl font-black tabular-nums text-lime">{p.score}</p>
          </div>
        ))}
      </div>

      <h3 className="mt-6 text-sm font-bold uppercase tracking-wider text-slate-300">Every call</h3>
      <ol className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {(state?.calls ?? []).map((c) => {
          const it = getTechnicalItem(c.number, customBank)
          return (
            <li key={c.seq} className="flex items-baseline gap-2 rounded-md border border-edge bg-panel/50 px-2 py-1">
              <span className="text-[10px] tabular-nums text-slate-500">#{c.seq}</span>
              <span className="font-bold text-cyan">{it.term}</span>
              <span className="truncate text-xs text-slate-400">{it.clue || c.clue}</span>
            </li>
          )
        })}
      </ol>

      <div className="mt-4 flex gap-2">
        <Link to="/" className="btn text-xs">
          New game
        </Link>
      </div>
    </section>
  )
}
