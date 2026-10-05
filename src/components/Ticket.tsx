'use client'

import { useEffect, useRef, useState } from 'react'
import type { Ticket as TicketType } from '@/lib/types'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'
import { useTheme } from '@/lib/theme'

interface Props {
  ticket: TicketType | null
  /** Numbers manually clicked/selected by the player */
  playerMarked: ReadonlySet<number>
  /** Numbers cut by penalty */
  cut: ReadonlySet<number>
  /** Called number, flashed on arrival */
  latest?: number | null
  /** Custom bank of questions/terms if configured */
  customBank?: TechnicalItem[] | null
  /** Callback when player clicks a cell to select / unselect */
  onToggleCell?: (cell: number) => void
  className?: string
  /** Whether to show raw numbers instead of technical terms */
  showNumbersOnly?: boolean
}

export function Ticket({
  ticket,
  playerMarked,
  cut,
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
            const isSelected = !isCut && playerMarked.has(cell)

            // Dynamic cell appearance
            let cellStyle = ''
            if (isCut) {
              cellStyle = isLight
                ? 'border-red-300 bg-red-50 text-red-700 line-through opacity-75'
                : 'border-rose/60 bg-rose/10 text-rose line-through'
            } else if (isSelected) {
              // User has manually clicked and selected this cell
              cellStyle = isLight
                ? 'border-emerald-500 bg-emerald-100 text-emerald-950 font-bold shadow-sm ring-2 ring-emerald-400/50 cursor-pointer'
                : 'border-lime/90 bg-lime/25 text-lime font-bold ring-2 ring-lime/40 cursor-pointer'
            } else {
              // Unselected waiting cell - matches user's reference image
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
                aria-pressed={isSelected}
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
                  onToggleCell && !isCut ? 'active:scale-95 cursor-pointer select-none' : '',
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

                {/* User Selected Checkmark badge */}
                {isSelected && (
                  <span
                    className={`absolute bottom-0.5 right-1 text-[10px] font-black ${
                      isLight ? 'text-emerald-700' : 'text-lime'
                    }`}
                  >
                    ✓
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5 font-medium">
            <span className={`inline-block h-3 w-3 rounded-sm border ${
              isLight ? 'border-emerald-500 bg-emerald-200' : 'border-lime/90 bg-lime/30'
            }`} />
            Selected ✓ (click again to unselect)
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className={`inline-block h-3 w-3 rounded-sm border ${
              isLight ? 'border-[#ced4da] bg-[#e9ecef]' : 'border-edge bg-panel'
            }`} />
            Unselected
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span className={`inline-block h-3 w-3 rounded-sm border ${
              isLight ? 'border-red-300 bg-red-100' : 'border-rose/60 bg-rose/20'
            }`} />
            Cut ✂
          </span>
        </div>

        {onToggleCell && (
          <p className="text-[11px] font-semibold text-cyan">
            💡 Use your knowledge: tap a cell to select it, or tap again to unselect!
          </p>
        )}
      </div>
    </div>
  )
}
