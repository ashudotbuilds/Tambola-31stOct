import { useState, type CSSProperties } from 'react'
import type { Ticket as TicketType } from '@/lib/types'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'

interface Props {
  ticket: TicketType | null
  playerMarked: ReadonlySet<number>
  cut: ReadonlySet<number>
  customBank?: TechnicalItem[] | null
  onToggleCell?: (cell: number) => void
  className?: string
  label?: string
  showNumbersOnly?: boolean
}

export function Ticket({ ticket, playerMarked, cut, customBank = null, onToggleCell, className = '', label = 'Your technical ticket', showNumbersOnly = false }: Props) {
  const [inspectCell, setInspectCell] = useState<number | null>(null)
  if (!ticket) return <div className="card p-6 text-center text-sm text-slate-400">Loading your ticket…</div>
  const inspected = inspectCell ? getTechnicalItem(inspectCell, customBank) : null
  return <section className={`card ticket-surface p-2 sm:p-4 ${className}`} aria-label="Tambola ticket">
    <div className="mb-1.5 sm:mb-3 flex flex-wrap justify-between gap-1 text-[10px] leading-none sm:text-xs sm:leading-normal text-slate-400">
      <span className="font-mono uppercase tracking-wider">{label}</span>
      <span className="hidden sm:inline">9 columns × 3 rows</span>
    </div>
    <div className="mb-1 grid grid-cols-3 gap-1 text-center font-mono text-[9px] leading-none uppercase tracking-wider text-cyan sm:hidden" aria-hidden="true">
      <span>Top line</span><span>Middle line</span><span>Bottom line</span>
    </div>
    <div className="ticket-grid">
      {ticket.flatMap((row, r) => row.map((cell, c) => {
        const style = { '--ticket-row': r + 1, '--ticket-col': c + 1 } as CSSProperties
        if (cell === null) return <div key={`${r}-${c}`} style={style} className="ticket-cell ticket-blank" aria-hidden="true"><span>·</span></div>
        const item = getTechnicalItem(cell, customBank)
        const selected = playerMarked.has(cell) && !cut.has(cell)
        return <button key={`${r}-${c}`} type="button" style={style} disabled={!onToggleCell || cut.has(cell)}
          title={`#${cell}: ${item.term}`} aria-pressed={selected} aria-label={`${['Top', 'Middle', 'Bottom'][r]} line, ${item.term}, ${selected ? 'selected' : 'unselected'}`}
          onClick={() => { setInspectCell(cell); onToggleCell?.(cell) }}
          className={`ticket-cell ${selected ? 'border-lime bg-lime/20 text-lime' : 'border-edge bg-panel text-slate-100'} ${cut.has(cell) ? 'line-through opacity-50' : ''}`}>
          <span className="absolute left-1 top-0.5 sm:left-1.5 sm:top-1 font-mono text-[8px] sm:text-[9px] text-slate-500">{cell}</span>
          <span className="ticket-term w-full break-words px-1 pt-2 pb-1 text-[11px] sm:py-3 sm:text-xs font-bold leading-[1.15] sm:leading-snug">{showNumbersOnly ? cell : item.term}</span>
          {selected && <span className="absolute bottom-0.5 right-1 text-[10px] sm:bottom-1 sm:right-1.5 sm:text-xs" aria-hidden="true">✓</span>}
        </button>
      }))}
    </div>
    <div className="ticket-help mt-1.5 border-t border-edge pt-1.5 text-[10px] leading-tight text-slate-400 sm:mt-3 sm:pt-3 sm:text-xs" aria-live="polite">
      {inspected ? <p className="truncate sm:whitespace-normal" title={`${inspected.term} (${inspected.category})`}><span className="text-cyan">#{inspected.id}</span> {inspected.term} <span className="hidden sm:inline">({inspected.category})</span></p>
        : <p>Tap to mark · Tap again to unmark<span className="hidden sm:inline">. Each line keeps its original claim pattern.</span></p>}
    </div>
  </section>
}
