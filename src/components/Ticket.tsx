'use client'

import { useEffect, useRef, useState } from 'react'
import type { Ticket as TicketType } from '@/lib/types'

interface Props {
  ticket: TicketType | null
  marked: ReadonlySet<number>
  cut: ReadonlySet<number>
  /** Called number, flashed on arrival. */
  latest?: number | null
  className?: string
}

export function Ticket({ ticket, marked, cut, latest = null, className = '' }: Props) {
  const [flash, setFlash] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (latest === null || !ticket) return
    const onTicket = ticket.some((row) => row.includes(latest))
    if (!onTicket) return
    setFlash(latest)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(null), 900)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [latest, ticket])

  if (!ticket) {
    return <div className={`card p-4 text-center text-sm text-slate-400 ${className}`}>No ticket yet</div>
  }

  return (
    <div className={`card p-3 sm:p-4 ${className}`}>
      <div className="grid grid-cols-9 gap-1 sm:gap-1.5">
        {ticket.map((row, r) =>
          row.map((cell, c) => {
            if (cell === null) {
              return <div key={`${r}-${c}`} className="cell border-edge/60 bg-ink/60" aria-hidden="true" />
            }
            const isCut = cut.has(cell)
            const isMarked = marked.has(cell) && !isCut
            const isLatest = flash === cell
            return (
              <div
                key={`${r}-${c}`}
                className={[
                  'cell',
                  isCut
                    ? 'border-rose/60 bg-rose/10 text-rose line-through'
                    : isMarked
                      ? 'border-lime/70 bg-lime/15 text-lime'
                      : 'border-edge bg-panel text-slate-300',
                  isLatest ? 'animate-pop' : '',
                ].join(' ')}
                title={isCut ? `${cell} was cut` : undefined}
              >
                <span>{cell}</span>
                {isCut ? (
                  <span className="absolute -right-0.5 -top-0.5 text-[9px]" aria-hidden="true">
                    ✂
                  </span>
                ) : null}
                {isMarked ? (
                  <span className="absolute bottom-0 right-0.5 text-[9px] opacity-70" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </div>
            )
          }),
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-lime/70 bg-lime/15" /> marked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-edge bg-panel" /> waiting
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm border border-rose/60 bg-rose/10" /> cut
        </span>
      </div>
    </div>
  )
}
