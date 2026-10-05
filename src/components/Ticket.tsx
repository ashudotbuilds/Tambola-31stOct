'use client'

import { useEffect, useRef, useState } from 'react'
import type { Ticket as TicketType } from '@/lib/types'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'
import { useTheme } from '@/lib/theme'

interface Props {
  ticket: TicketType | null
  /** Officially marked numbers from server */
  marked: ReadonlySet<number>
  /** Numbers cut by penalty */
  cut: ReadonlySet<number>
  /** Numbers manually clicked/daubed by the player */
  playerMarked?: ReadonlySet<number>
  /** Numbers whose answers have officially been revealed by the host */
  revealedNumbers?: ReadonlySet<number>
  /** Latest called number, flashed on arrival */
  latest?: number | null
  /** Custom bank of questions/terms if configured */
  customBank?: TechnicalItem[] | null
  /** Callback when player clicks a cell to manually mark/unmark */
  onToggleCell?: (cell: number) => void
  className?: string
  /** Whether to show raw numbers instead of technical terms */
  showNumbersOnly?: boolean
}

export function Ticket({
  ticket,
  marked,
  cut,
  playerMarked = new Set(),
  revealedNumbers = new Set(),
  latest = null,
  customBank = null,
  onToggleCell,
  className = '',
  showNumbersOnly = false,
}: Props) {
  const { theme } = useTheme()
  const [flash, setFlash] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (latest === null || !ticket) return
    const onTicket = ticket.some((row) => row.includes(latest))
    if (!onTicket) return
    setFlash(latest)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(null), 1200)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [latest, ticket])

  if (!ticket) {
    return (
      <div className={`card p-6 text-center text-sm ${theme === 'light' ? 'text-slate-500' : 'text-slate-400'} ${className}`}>
        No ticket yet
      </div>
    )
  }

  const isLight = theme === 'light'

  return (
    <div className={`card p-2 sm:p-4 transition-all ${className} ${isLight ? 'bg-white border-slate-200 shadow-sm' : ''}`}>
      {/* 3x9 Ticket Grid */}
      <div className="grid grid-cols-9 gap-1 sm:gap-2">
        {ticket.map((row, r) =>
          row.map((cell, c) => {
            if (cell === null) {
              return (
                <div
                  key={`${r}-${c}`}
                  className={`cell ${
                    isLight
                      ? 'border-transparent bg-[#f1f3f5]/60'
                      : 'border-edge/50 bg-ink/40'
                  }`}
                  aria-hidden="true"
                />
              )
            }

            const item = getTechnicalItem(cell, customBank)
            const isCut = cut.has(cell)
            const isLatest = flash === cell

            // Status checks
            const isOfficiallyRevealed = revealedNumbers.has(cell) || marked.has(cell)
            const hasPlayerClicked = playerMarked.has(cell)
            const isConfirmed = !isCut && ((marked.has(cell) && hasPlayerClicked) || (marked.has(cell) && isOfficiallyRevealed))
            const isPendingSelfMark = !isCut && hasPlayerClicked && !isOfficiallyRevealed
            const isRevealedUnclicked = !isCut && isOfficiallyRevealed && !hasPlayerClicked && !marked.has(cell)

            // Dynamic cell appearance matching user's reference image in light mode
            let cellStyle = ''
            if (isCut) {
              cellStyle = isLight
                ? 'border-red-300 bg-red-50 text-red-700 line-through opacity-75'
                : 'border-rose/60 bg-rose/10 text-rose line-through'
            } else if (isConfirmed) {
              cellStyle = isLight
                ? 'border-emerald-400 bg-emerald-50 text-emerald-900 shadow-sm font-bold ring-1 ring-emerald-400/50'
                : 'border-lime/80 bg-lime/20 text-lime font-bold ring-1 ring-lime/40'
            } else if (isPendingSelfMark) {
              cellStyle = isLight
                ? 'border-blue-400 bg-blue-50 text-blue-900 shadow-sm ring-1 ring-blue-300'
                : 'border-cyan/70 bg-cyan/15 text-cyan ring-1 ring-cyan/40'
            } else if (isRevealedUnclicked) {
              cellStyle = isLight
                ? 'border-amber-400 bg-amber-50 text-amber-900 animate-pulse ring-2 ring-amber-400'
                : 'border-amber/80 bg-amber/20 text-amber animate-pulse ring-2 ring-amber'
            } else {
              // Default waiting state - screenshot style: light gray cards with crisp dark text
              cellStyle = isLight
                ? 'border-[#ced4da] bg-[#e9ecef] hover:bg-[#dee2e6] text-slate-800 hover:border-slate-400 shadow-[0_1px_2px_rgba(0,0,0,0.04)] cursor-pointer'
                : 'border-edge bg-panel hover:bg-panel/90 text-slate-200 hover:border-cyan/50 cursor-pointer'
            }

            const displayText = showNumbersOnly ? String(cell) : item.term

            return (
              <div
                key={`${r}-${c}`}
                role={onToggleCell ? 'button' : undefined}
                tabIndex={onToggleCell && !isCut ? 0 : undefined}
                onClick={() => {
                  if (!isCut && onToggleCell) {
                    onToggleCell(cell)
                  }
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isCut && onToggleCell) {
                    e.preventDefault()
                    onToggleCell(cell)
                  }
                }}
                className={[
                  'cell group relative overflow-hidden transition-all duration-150',
                  cellStyle,
                  isLatest ? 'animate-pop ring-2 ring-cyan' : '',
                  onToggleCell && !isCut ? 'active:scale-95 cursor-pointer' : '',
                ].join(' ')}
                title={`#${cell} [${item.category}]: ${item.term} — ${item.clue}`}
              >
                {/* Number hint badge in corner */}
                <span
                  className={`absolute top-0.5 left-1 text-[8px] sm:text-[9px] font-mono opacity-40 select-none ${
                    isLight ? 'text-slate-600' : 'text-slate-400'
                  }`}
                >
                  {cell}
                </span>

                {/* Main Technical Term / Text */}
                <span className="w-full px-0.5 text-center text-[10px] sm:text-[11px] md:text-xs font-semibold leading-tight break-words line-clamp-3">
                  {displayText}
                </span>

                {/* Cut badge */}
                {isCut && (
                  <span className="absolute -top-1 -right-1 text-[10px]" title="Number cut">
                    ✂
                  </span>
                )}

                {/* Confirmed mark badge */}
                {isConfirmed && (
                  <span
                    className={`absolute bottom-0.5 right-1 text-[9px] font-bold ${
                      isLight ? 'text-emerald-700' : 'text-lime'
                    }`}
                  >
                    ✓
                  </span>
                )}

                {/* Self marked (pending admin reveal) */}
                {isPendingSelfMark && (
                  <span
                    className={`absolute bottom-0.5 right-1 text-[8px] font-bold ${
                      isLight ? 'text-blue-700' : 'text-cyan'
                    }`}
                    title="Marked by you (waiting for admin to reveal answer)"
                  >
                    ★
                  </span>
                )}

                {/* Revealed by admin but player hasn't clicked */}
                {isRevealedUnclicked && (
                  <span
                    className={`absolute bottom-0.5 right-1 text-[8px] font-bold ${
                      isLight ? 'text-amber-700' : 'text-amber'
                    }`}
                    title="Answer revealed! Click to daub!"
                  >
                    ●
                  </span>
                )}
              </div>
            )
          }),
        )}
      </div>

      {/* Legend & Instructions */}
      <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-[11px] ${
        isLight ? 'border-slate-200 text-slate-600' : 'border-edge text-slate-400'
      }`}>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm border ${
              isLight ? 'border-emerald-400 bg-emerald-100' : 'border-lime/70 bg-lime/20'
            }`} />
            Confirmed ✓
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm border ${
              isLight ? 'border-blue-400 bg-blue-100' : 'border-cyan/70 bg-cyan/20'
            }`} />
            Marked by you ★
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm border ${
              isLight ? 'border-[#ced4da] bg-[#e9ecef]' : 'border-edge bg-panel'
            }`} />
            Unmarked
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm border ${
              isLight ? 'border-red-300 bg-red-100' : 'border-rose/60 bg-rose/20'
            }`} />
            Cut ✂
          </span>
        </div>

        {onToggleCell && (
          <p className="text-[10px] italic opacity-80">
            💡 Tap any cell on your ticket to mark your answer!
          </p>
        )}
      </div>
    </div>
  )
}
