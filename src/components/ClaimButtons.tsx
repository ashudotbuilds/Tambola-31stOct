'use client'

import { CLAIMS, claimProgress, isClaimEligible, pointsFor } from '@/lib/claims'
import type { ClaimType, GameState, Ticket } from '@/lib/types'

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
  const live = state?.status === 'playing' || state?.status === 'closing'
  const firstHouseDone = taken.has('full_house')
  const penalty = state?.settings?.wrong_claim_penalty ?? 10

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {CLAIMS.map((claim) => {
        const alreadyWon = won.has(claim.type)
        const takenByOther = !alreadyWon && taken.has(claim.type)
        const eligible = isClaimEligible(claim.type, ticket, marked, cut)
        const progress = claimProgress(claim.type, ticket, marked, cut)
        const blockedByRules = claim.type === 'second_full_house' && !firstHouseDone
        const disabled = busy || !live || alreadyWon || takenByOther || blockedByRules
        const ready = !disabled && eligible

        return (
          <button
            key={claim.type}
            type="button"
            onClick={() => onClaim(claim.type)}
            disabled={disabled}
            title={claim.blurb}
            className={[
              'flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition',
              ready
                ? 'animate-pulse border-lime bg-lime/15 text-lime hover:bg-lime/25'
                : 'border-edge bg-panel/70 text-slate-300 hover:border-slate-500',
              disabled ? 'cursor-not-allowed opacity-50 hover:border-edge' : '',
              alreadyWon ? 'border-cyan/70 bg-cyan/10 text-cyan' : '',
              takenByOther ? 'border-slate-700 text-slate-500' : '',
            ].join(' ')}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="text-sm font-bold">{claim.label}</span>
              <span className="text-xs font-semibold tabular-nums opacity-80">
                +{pointsFor(claim.type, state?.settings)}
              </span>
            </span>
            <span className="text-[11px] leading-tight opacity-70">
              {alreadyWon
                ? 'claimed'
                : takenByOther
                  ? 'already taken'
                  : blockedByRules
                    ? 'needs a full house first'
                    : `${progress.have}/${progress.need}`}
            </span>
          </button>
        )
      })}
      <p className="col-span-full mt-1 text-[11px] text-slate-500">
        A wrong claim costs {penalty} points and cuts one of your marked numbers.
      </p>
    </div>
  )
}
