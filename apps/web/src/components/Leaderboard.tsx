import type { PlayerRow } from '@/lib/types'

interface Props {
  players: PlayerRow[]
  meId?: string | null
  limit?: number
  className?: string
  dense?: boolean
}

export function Leaderboard({ players, meId, limit, className = '', dense = false }: Props) {
  const rows = (limit ? players.slice(0, limit) : players).map((p, i) => ({ ...p, rank: i + 1 }))

  if (rows.length === 0) {
    return <p className={`text-sm text-slate-500 ${className}`}>Nobody has joined yet.</p>
  }

  return (
    <ol className={`flex flex-col gap-1.5 ${className}`}>
      {rows.map((p) => {
        const mine = p.id === meId
        return (
          <li
            key={p.id}
            className={[
              'flex items-center gap-3 rounded-lg border px-3 py-2',
              mine ? 'border-cyan/60 bg-cyan/10' : 'border-edge bg-panel/60',
              dense ? 'py-1.5 text-sm' : '',
            ].join(' ')}
          >
            <span
              className={[
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold tabular-nums',
                p.rank === 1 ? 'bg-amber/20 text-amber' : 'bg-ink text-slate-400',
              ].join(' ')}
            >
              {p.rank}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              {p.name}
              {p.is_host ? <span className="ml-1.5 text-[10px] font-normal uppercase text-cyan">host</span> : null}
              {p.wrong_claims > 0 ? (
                <span className="ml-1.5 text-[10px] font-normal text-rose">{p.wrong_claims} cut</span>
              ) : null}
            </span>
            <span className="shrink-0 font-bold tabular-nums text-lime">{p.score}</span>
          </li>
        )
      })}
    </ol>
  )
}
