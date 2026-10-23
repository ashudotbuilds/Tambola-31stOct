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
  const [inspectCell, setInspectCell] = useState<number | null>(null)
  const [mobileFit, setMobileFit] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
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
      <div
        className={`card p-6 text-center text-sm ${
          theme === 'light' ? 'text-slate-500' : 'text-slate-400'
        } ${className}`}
      >
        No ticket yet
      </div>
    )
  }

  const isLight = theme === 'light'

  // Scroll to column band
  const scrollToBand = (colIndex: number) => {
    if (!scrollContainerRef.current) return
    const target = (scrollContainerRef.current.scrollWidth / 9) * colIndex
    scrollContainerRef.current.scrollTo({ left: target, behavior: 'smooth' })
  }

  const inspectedItem = inspectCell ? getTechnicalItem(inspectCell, customBank) : null

  return (
    <div
      className={`card relative p-2.5 sm:p-4 transition-all ${className} ${
        isLight ? 'bg-white border-slate-200 shadow-sm' : ''
      }`}
    >
      {/* Mobile Top Navigation & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1 text-xs">
        {/* Quick jump pills for mobile */}
        <div className="flex sm:hidden items-center gap-1">
          <span className="text-[10px] text-slate-400 font-medium">Cols:</span>
          <button
            type="button"
            onClick={() => scrollToBand(0)}
            className="min-h-11 min-w-11 px-2 py-0.5 rounded bg-ink/20 dark:bg-panel border border-edge/60 text-[10px] font-bold hover:text-cyan"
          >
            1–3
          </button>
          <button
            type="button"
            onClick={() => scrollToBand(3)}
            className="min-h-11 min-w-11 px-2 py-0.5 rounded bg-ink/20 dark:bg-panel border border-edge/60 text-[10px] font-bold hover:text-cyan"
          >
            4–6
          </button>
          <button
            type="button"
            onClick={() => scrollToBand(6)}
            className="min-h-11 min-w-11 px-2 py-0.5 rounded bg-ink/20 dark:bg-panel border border-edge/60 text-[10px] font-bold hover:text-cyan"
          >
            7–9
          </button>
        </div>

        {/* Mobile View Toggle: Scroll vs Fit */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={() => setMobileFit((prev) => !prev)}
            className="sm:hidden min-h-11 px-2 text-[10px] font-semibold text-cyan hover:underline"
          >
            {mobileFit ? '↔ Swipe View' : '⤢ Fit Screen'}
          </button>
          <span className="hidden sm:inline-block text-[11px] text-slate-400 font-medium">
            3×9 Technical Ticket
          </span>
        </div>
      </div>

      {/* 3x9 Ticket Grid Wrapper (Scrollable on small devices for max readability) */}
      <div
        ref={scrollContainerRef}
        className={`relative overflow-x-auto no-scrollbar pb-1 sm:pb-0 ${
          mobileFit ? 'w-full' : 'w-full overflow-x-auto'
        }`}
      >
        <div
          className={`grid grid-cols-9 gap-1 sm:gap-2 ${
            mobileFit ? 'w-full min-w-0' : 'min-w-[620px] sm:min-w-0 w-full'
          }`}
        >
          {ticket.map((row, r) =>
            row.map((cell, c) => {
              if (cell === null) {
                return (
                  <div
                    key={`${r}-${c}`}
                    className={`cell min-h-[56px] sm:min-h-[72px] md:min-h-[78px] ${
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

              let cellStyle = ''
              if (isCut) {
                cellStyle = isLight
                  ? 'border-red-300 bg-red-50 text-red-700 line-through opacity-75'
                  : 'border-rose/60 bg-rose/10 text-rose line-through'
              } else if (isSelected) {
                cellStyle = isLight
                  ? 'border-emerald-500 bg-emerald-100 text-emerald-950 font-bold shadow-sm ring-2 ring-emerald-400/50'
                  : 'border-lime/90 bg-lime/25 text-lime font-bold ring-2 ring-lime/40'
              } else {
                cellStyle = isLight
                  ? 'border-[#ced4da] bg-[#e9ecef] hover:bg-[#dee2e6] text-slate-800 hover:border-slate-400 shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                  : 'border-edge bg-panel hover:bg-panel/90 text-slate-200 hover:border-cyan/50'
              }

              const displayText = showNumbersOnly ? String(cell) : item.term

              return (
                <div
                  key={`${r}-${c}`}
                  role={onToggleCell ? 'button' : undefined}
                  tabIndex={onToggleCell && !isCut ? 0 : undefined}
                  aria-pressed={isSelected}
                  aria-disabled={onToggleCell ? isCut : undefined}
                  onClick={() => {
                    setInspectCell(cell)
                    if (!isCut && onToggleCell) {
                      onToggleCell(cell)
                    }
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isCut && onToggleCell) {
                      e.preventDefault()
                      setInspectCell(cell)
                      onToggleCell(cell)
                    }
                  }}
                  className={[
                    'cell group relative overflow-hidden transition-all duration-150 min-h-[58px] sm:min-h-[72px] md:min-h-[78px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan',
                    cellStyle,
                    isLatest ? 'animate-pop ring-2 ring-cyan' : '',
                    onToggleCell && !isCut ? 'cursor-pointer active:scale-95' : '',
                  ].join(' ')}
                  title={`#${cell} [${item.category}]: ${item.term}`}
                >
                  {/* Item ID badge */}
                  <span
                    className={`absolute top-0.5 left-1 text-[8px] sm:text-[9px] font-mono opacity-40 select-none ${
                      isLight ? 'text-slate-600' : 'text-slate-400'
                    }`}
                  >
                    {cell}
                  </span>

                  {/* Main Technical Term Text */}
                  <span className="w-full px-0.5 text-center text-[10px] sm:text-[11px] md:text-xs font-semibold leading-tight break-words line-clamp-3">
                    {displayText}
                  </span>

                  {/* Cut icon */}
                  {isCut && (
                    <span className="absolute -top-1 -right-1 text-[10px]" title="Number cut">
                      ✂
                    </span>
                  )}

                  {/* Selected checkmark */}
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
      </div>

      {/* Mobile Swipe Hint */}
      {!mobileFit && (
        <div className="sm:hidden flex items-center justify-between text-[10px] text-slate-400 mt-1 px-1">
          <span>Swipe horizontally to view all 9 columns ↔</span>
          <span className="font-mono text-cyan">{playerMarked.size}/15 marked</span>
        </div>
      )}

      {/* Selected Cell Inspector Drawer on Mobile */}
      {inspectedItem && (
        <div
          className={`mt-3 rounded-xl border p-2.5 text-xs transition-all ${
            isLight
              ? 'border-cyan-200 bg-cyan-50/70 text-slate-800'
              : 'border-cyan/40 bg-cyan/10 text-slate-200'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-bold">
              <span className="font-mono text-cyan">#{inspectedItem.id}</span>
              <span>{inspectedItem.term}</span>
              <span className="text-[10px] font-normal opacity-70">({inspectedItem.category})</span>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                playerMarked.has(inspectedItem.id)
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-lime'
                  : 'bg-slate-500/20 text-slate-400'
              }`}
            >
              {playerMarked.has(inspectedItem.id) ? 'Selected ✓' : 'Unselected'}
            </span>
          </div>
        </div>
      )}

      {/* Legend & Instructions */}
      <div
        className={`mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-[11px] ${
          isLight ? 'border-slate-200 text-slate-600' : 'border-edge text-slate-400'
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5 font-medium">
            <span
              className={`inline-block h-3 w-3 rounded-sm border ${
                isLight ? 'border-emerald-500 bg-emerald-200' : 'border-lime/90 bg-lime/30'
              }`}
            />
            Selected ✓ (click again to unselect)
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span
              className={`inline-block h-3 w-3 rounded-sm border ${
                isLight ? 'border-[#ced4da] bg-[#e9ecef]' : 'border-edge bg-panel'
              }`}
            />
            Unselected
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <span
              className={`inline-block h-3 w-3 rounded-sm border ${
                isLight ? 'border-red-300 bg-red-100' : 'border-rose/60 bg-rose/20'
              }`}
            />
            Cut ✂
          </span>
        </div>

        {onToggleCell && (
          <p className="text-[11px] font-semibold text-cyan">
            💡 Tap any cell to select or unselect it using your knowledge!
          </p>
        )}
      </div>
    </div>
  )
}
