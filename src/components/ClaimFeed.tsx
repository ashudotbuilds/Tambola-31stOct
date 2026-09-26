'use client'

import { claimLabel } from '@/lib/claims'
import type { ClaimRow } from '@/lib/types'

interface Props {
  claims: ClaimRow[]
  limit?: number
  className?: string
}

export function ClaimFeed({ claims, limit = 12, className = '' }: Props) {
  const rows = [...claims].reverse().slice(0, limit)

  if (rows.length === 0) {
    return <p className={`text-sm text-slate-500 ${className}`}>No claims yet.</p>
  }

  return (
    <ul className={`flex flex-col gap-1.5 ${className}`}>
      {rows.map((claim) => {
        const won = claim.status === 'accepted'
        return (
          <li
            key={claim.id}
            className={[
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
              won ? 'border-lime/60 bg-lime/10' : 'border-rose/50 bg-rose/10',
            ].join(' ')}
          >
            <span className="text-base" aria-hidden="true">
              {won ? '✅' : '✗'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{claim.name}</span>{' '}
              <span className="opacity-80">{claimLabel(claim.claim_type)}</span>
              {!won && claim.reason ? (
                <span className="block text-[11px] text-rose/90">{claim.reason}</span>
              ) : null}
            </span>
            <span className={`shrink-0 font-bold tabular-nums ${won ? 'text-lime' : 'text-rose'}`}>
              {won ? `+${claim.points}` : claim.points}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
