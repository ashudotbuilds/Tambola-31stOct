import type { Connection } from '@/hooks/useGameRoom'
import type { GameStatus } from '@/lib/types'

export function ConnectionDot({ connection }: { connection: Connection }) {
  const tone =
    connection === 'live' ? 'bg-lime' : connection === 'connecting' ? 'bg-amber' : 'bg-rose'
  const text =
    connection === 'live' ? 'live' : connection === 'connecting' ? 'connecting' : 'reconnecting'
  return (
    <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400">
      <span className={`h-2 w-2 rounded-full ${tone} ${connection === 'live' ? 'animate-pulse' : ''}`} />
      {text}
    </span>
  )
}

export function StatusPill({ status }: { status: GameStatus }) {
  const map: Record<GameStatus, string> = {
    lobby: 'bg-slate-600/40 text-slate-200',
    playing: 'bg-lime/20 text-lime',
    paused: 'bg-amber/20 text-amber',
    closing: 'bg-cyan/20 text-cyan',
    finished: 'bg-rose/20 text-rose',
  }
  return (
    <span className={`rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${map[status]}`}>
      {status === 'closing' ? 'closing' : status}
    </span>
  )
}

export function CodeChip({ code, className = '' }: { code: string; className?: string }) {
  return (
    <span
      className={`font-mono text-2xl font-black tracking-[0.35em] text-cyan sm:text-3xl ${className}`}
      aria-label={`Game code ${code.split('').join(' ')}`}
    >
      {code}
    </span>
  )
}
