'use client'

interface Props {
  called: ReadonlySet<number>
  latest?: number | null
  /** Hide numbers that are still on the ticket, so the remaining set reads clearly. */
  compact?: boolean
  className?: string
  cellClassName?: string
}

export function NumberBoard({ called, latest = null, compact = false, className = '', cellClassName = '' }: Props) {
  return (
    <div
      className={`grid grid-cols-10 gap-1 sm:gap-1.5 ${className}`}
      role="list"
      aria-label="Called numbers"
    >
      {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => {
        const on = called.has(n)
        const isLatest = latest === n
        return (
          <div
            key={n}
            role="listitem"
            className={[
              'flex aspect-square items-center justify-center rounded border text-[10px] font-bold tabular-nums sm:text-xs',
              compact ? 'sm:text-[10px]' : '',
              on ? 'border-cyan/70 bg-cyan/20 text-cyan' : 'border-edge/70 bg-ink/50 text-slate-600',
              isLatest ? 'animate-pop border-cyan bg-cyan/40 text-ink' : '',
              cellClassName,
            ].join(' ')}
          >
            {n}
          </div>
        )
      })}
    </div>
  )
}
