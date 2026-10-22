import { CLAIMS, claimProgress, isClaimEligible, pointsFor } from '@/lib/claims'
import type { ClaimType, GameState, Ticket } from '@/lib/types'
import { useTheme } from '@/lib/theme'

interface Props {
  ticket: Ticket | null
  marked: ReadonlySet<number>
  cut: ReadonlySet<number>
  state: GameState | null
  /** Claim types this player already won. */
  won: ReadonlySet<ClaimType>
  /** Claim types somebody else already won. */
  taken: ReadonlySet<ClaimType>
  busy: boolean
  onClaim: (claim: ClaimType) => void
}

export function ClaimButtons({ ticket, marked, cut, state, won, taken, busy, onClaim }: Props) {
  const { theme } = useTheme()
  const live = state?.status === 'playing' || state?.status === 'closing'
  const firstHouseDone = taken.has('full_house')
  const penalty = state?.settings?.wrong_claim_penalty ?? 10
  const isLight = theme === 'light'

  // Count ready claims to highlight for mobile
  const readyCount = CLAIMS.filter((claim) => {
    const alreadyWon = won.has(claim.type)
    const takenByOther = !alreadyWon && taken.has(claim.type)
    const eligible = isClaimEligible(claim.type, ticket, marked, cut)
    const blockedByRules = claim.type === 'second_full_house' && !firstHouseDone
    const disabled = busy || !live || alreadyWon || takenByOther || blockedByRules
    return !disabled && eligible
  }).length

  return (
    <div className="space-y-2">
      {/* Mobile Claim Available Banner */}
      {readyCount > 0 && (
        <div className="animate-pulse rounded-xl border border-emerald-500/60 bg-emerald-500/15 p-2.5 text-center text-xs font-bold text-emerald-700 dark:text-lime shadow-sm">
          🎉 {readyCount} Claim{readyCount > 1 ? 's' : ''} Ready! Tap the highlighted button below to submit!
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CLAIMS.map((claim) => {
          const alreadyWon = won.has(claim.type)
          const takenByOther = !alreadyWon && taken.has(claim.type)
          const eligible = isClaimEligible(claim.type, ticket, marked, cut)
          const progress = claimProgress(claim.type, ticket, marked, cut)
          const blockedByRules = claim.type === 'second_full_house' && !firstHouseDone
          const disabled = busy || !live || alreadyWon || takenByOther || blockedByRules
          const ready = !disabled && eligible

          let buttonStyle = ''
          if (ready) {
            buttonStyle = isLight
              ? 'animate-pulse border-emerald-500 bg-emerald-100 text-emerald-950 font-bold shadow-md ring-2 ring-emerald-400'
              : 'animate-pulse border-lime bg-lime/20 text-lime font-bold shadow-md ring-2 ring-lime/40'
          } else if (alreadyWon) {
            buttonStyle = isLight
              ? 'border-blue-400 bg-blue-50 text-blue-800'
              : 'border-cyan/70 bg-cyan/15 text-cyan'
          } else if (takenByOther) {
            buttonStyle = isLight
              ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-60'
              : 'border-slate-800 bg-ink/40 text-slate-500 opacity-50'
          } else {
            buttonStyle = isLight
              ? 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 shadow-sm'
              : 'border-edge bg-panel/70 text-slate-300 hover:border-slate-500'
          }

          return (
            <button
              key={claim.type}
              type="button"
              onClick={() => onClaim(claim.type)}
              disabled={disabled}
              title={claim.blurb}
              className={[
                'flex flex-col items-start gap-1 rounded-xl border p-2.5 sm:p-3 text-left transition select-none active:scale-95 min-h-[58px]',
                buttonStyle,
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              ].join(' ')}
              style={{ touchAction: 'manipulation' }}
            >
              <div className="flex w-full items-center justify-between gap-1">
                <span className="text-xs sm:text-sm font-bold truncate">{claim.label}</span>
                <span className="text-[10px] sm:text-xs font-semibold tabular-nums opacity-85 shrink-0">
                  +{pointsFor(claim.type, state?.settings)}
                </span>
              </div>
              <span className="text-[10px] sm:text-[11px] leading-tight opacity-75 font-mono">
                {alreadyWon
                  ? 'claimed'
                  : takenByOther
                    ? 'taken'
                    : blockedByRules
                      ? 'needs 1st house'
                      : `${progress.have}/${progress.need}`}
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-[10px] sm:text-[11px] text-slate-500 text-center sm:text-left">
        A wrong claim costs {penalty} points and cuts one of your marked numbers.
      </p>
    </div>
  )
}
