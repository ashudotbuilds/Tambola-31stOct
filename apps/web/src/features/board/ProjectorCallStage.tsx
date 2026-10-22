import type { CallRow } from '@/lib/types'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'
import { useTheme } from '@/lib/theme'

export function ProjectorCallStage({
  call,
  status,
  isRevealed,
  customBank,
}: {
  call: CallRow | null
  status: string
  isRevealed: boolean
  customBank: TechnicalItem[] | null
}) {
  const { theme } = useTheme()
  const isLight = theme === 'light'

  if (!call) {
    return (
      <div className="card flex min-h-[260px] flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest bg-cyan/15 text-cyan border border-cyan/40">
          {status === 'lobby' ? 'Waiting to start' : 'Ready for Next Question'}
        </span>
        <p className="text-3xl font-black">Technical Tambola Challenge</p>
        <p className="text-base text-slate-400">Questions and code execution problems will appear here on the big screen.</p>
      </div>
    )
  }

  const item = getTechnicalItem(call.number, customBank)

  return (
    <div
      className={`card relative flex min-h-[280px] flex-col items-center justify-center gap-4 p-8 text-center shadow-xl transition-all ${
        isRevealed
          ? isLight
            ? 'border-emerald-300 bg-emerald-50/50'
            : 'border-cyan/50 bg-cyan/10'
          : isLight
            ? 'border-amber-300 bg-amber-50/50'
            : 'border-amber/50 bg-amber/10'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-ink px-3 py-1 font-mono text-sm font-bold text-slate-300">
          Call #{call.seq}
        </span>
        {item.category && (
          <span className="rounded-lg bg-purple-500/20 text-purple-400 px-3 py-1 text-xs font-bold">
            {item.category}
          </span>
        )}
        {isRevealed ? (
          <span className="rounded-full bg-emerald-500/20 text-emerald-600 dark:text-lime px-3 py-1 text-xs font-bold uppercase tracking-wider">
            ✓ Answer Revealed
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/20 text-amber-600 dark:text-amber px-3 py-1 text-xs font-bold uppercase tracking-wider animate-pulse">
            Decode on your tickets!
          </span>
        )}
      </div>

      <p className="max-w-4xl text-2xl sm:text-4xl md:text-5xl font-extrabold leading-snug tracking-tight">
        {item.clue || call.clue}
      </p>

      {item.codeSnippet && (
        <pre
          className={`p-4 rounded-xl text-left font-mono text-sm sm:text-base max-w-xl mx-auto overflow-x-auto shadow-inner ${
            isLight ? 'bg-slate-900 text-emerald-400' : 'bg-black/90 text-lime'
          }`}
        >
          {item.codeSnippet}
        </pre>
      )}

      {isRevealed ? (
        <div className="animate-pop mt-2 space-y-1">
          <p className="text-xs uppercase tracking-widest text-slate-400">Official Term</p>
          <div className="inline-block rounded-2xl bg-cyan/20 border-2 border-cyan px-8 py-3 shadow-2xl">
            <p className="text-4xl sm:text-6xl font-black text-cyan tracking-tight">{item.term}</p>
          </div>
          <p className="text-xs font-mono text-slate-400 mt-1">Item #{call.number}</p>
        </div>
      ) : (
        <p className="text-base font-bold text-amber-500 dark:text-amber-400 animate-pulse mt-2">
          ⚡ Waiting for host to reveal the answer... Tap your ticket if you know it!
        </p>
      )}
    </div>
  )
}
