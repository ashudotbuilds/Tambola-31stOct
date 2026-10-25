import { CLAIMS, pointsFor } from '@/lib/claims'
import type { ClaimType, GameState } from '@/lib/types'

interface Props {
  state: GameState | null
  won: ReadonlySet<ClaimType>
  taken: ReadonlySet<ClaimType>
  busy: boolean
  onClaim: (claim: ClaimType) => void
}

export function ClaimButtons({ state, won, taken, busy, onClaim }: Props) {
  const live = state?.status === 'playing' || state?.status === 'closing'
  return <section className="player-claims space-y-1.5 sm:space-y-3" aria-label="Claim a pattern">
    <div className="grid grid-cols-3 gap-1.5 sm:gap-2 sm:grid-cols-4">
      {CLAIMS.map(claim => {
        const alreadyWon = won.has(claim.type)
        const takenByOther = !alreadyWon && taken.has(claim.type)
        const blocked = claim.type === 'second_full_house' && !taken.has('full_house')
        return <button key={claim.type} type="button" onClick={() => onClaim(claim.type)}
          disabled={busy || !live || alreadyWon || takenByOther || blocked}
          title={claim.blurb}
          className={`flex min-h-11 sm:min-h-20 flex-col items-start justify-center sm:justify-between gap-0.5 sm:gap-2 rounded-md sm:rounded-lg border px-2 py-1.5 sm:p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${alreadyWon ? 'border-cyan bg-cyan/10 text-cyan' : 'border-edge bg-panel text-slate-200 enabled:hover:border-cyan'}`}>
          <span className="flex w-full flex-wrap items-center justify-between gap-0.5 text-[11px] leading-tight sm:text-sm sm:leading-normal font-bold"><span>{claim.label}</span><span className="text-[9px] sm:text-xs">+{pointsFor(claim.type, state?.settings)}</span></span>
          <span className={`text-[9px] leading-tight sm:text-xs sm:leading-normal text-slate-400 ${!alreadyWon && !takenByOther && !blocked ? 'hidden sm:inline' : ''}`}>{alreadyWon ? 'Claimed' : takenByOther ? 'Taken' : blocked ? 'After first house' : 'Tap to claim'}</span>
        </button>
      })}
    </div>
    <p className="text-[10px] sm:text-xs leading-snug sm:leading-relaxed text-slate-400">Claim only when your pattern is complete. Wrong claims warn you and notify the host; no deductions.</p>
  </section>
}
