import { useEffect, useRef, useState } from 'react'
import { play, speak, stopSpeaking } from '@/lib/sound'
import type { CallRow } from '@/lib/types'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'
import { useTheme } from '@/lib/theme'

export type CluePhase = 'idle' | 'clue' | 'revealed'

interface Props {
  /** The newest call, or null before the first one. */
  call: CallRow | null
  revealSeconds?: number
  pauseSeconds?: number
  speakClues?: boolean
  isHost?: boolean
  isRevealed?: boolean
  customBank?: TechnicalItem[] | null
  onRevealNow?: () => void
  onNextQuestion?: () => void
  onPhaseChange?: (phase: CluePhase) => void
  onReady?: () => void
  pendingClubbedCount?: number
}

export function ClueStage({
  call,
  speakClues = false,
  isHost = false,
  isRevealed = false,
  customBank = null,
  onRevealNow,
  onNextQuestion,
  pendingClubbedCount = 0,
}: Props) {
  const { theme } = useTheme()
  const [shown, setShown] = useState<CallRow | null>(null)
  const seqRef = useRef<number>(-1)

  useEffect(() => {
    if (!call) return
    if (call.seq !== seqRef.current) {
      seqRef.current = call.seq
      setShown(call)
      play('call')
      if (speakClues) speak(call.clue)
    }
  }, [call, speakClues])

  if (!shown) {
    return (
      <div className={`card flex min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center ${
        theme === 'light' ? 'bg-white border-slate-200' : ''
      }`}>
        <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider bg-cyan/15 text-cyan border border-cyan/40">
          Ready to Start
        </span>
        <p className="text-xl font-bold">Technical Tambola Challenge</p>
        <p className="max-w-md text-sm text-slate-500">
          {isHost
            ? 'Press CALL QUESTION or tap Spacebar to announce the first technical problem. You can reveal answers right away or club questions together.'
            : 'Waiting for the host to announce the first technical clue. Decode the clues and tap matching cells on your ticket!'}
        </p>
      </div>
    )
  }

  const item = getTechnicalItem(shown.number, customBank)
  const isLight = theme === 'light'

  return (
    <div
      className={`card relative flex min-h-[250px] flex-col items-center justify-center gap-4 overflow-hidden p-6 text-center transition-all ${
        isLight ? 'bg-white border-slate-200 shadow-md' : 'bg-panel/90 border-edge'
      }`}
    >
      {/* Top Meta Header */}
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <span
          className={`rounded-md px-2.5 py-1 text-xs font-mono font-bold tabular-nums ${
            isLight ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-ink text-slate-400'
          }`}
        >
          Call #{shown.seq}
        </span>

        {item.category && (
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-bold tracking-wide ${
              isLight ? 'bg-purple-100 text-purple-800' : 'bg-purple-900/30 text-purple-300 border border-purple-500/30'
            }`}
          >
            {item.category}
          </span>
        )}

        {isRevealed ? (
          <span className="rounded-md bg-emerald-500/15 border border-emerald-500/40 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-lime">
            ✓ Answer Revealed
          </span>
        ) : (
          <span className="rounded-md bg-amber-500/15 border border-amber-500/40 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber animate-pulse">
            Active Question · Waiting for Reveal
          </span>
        )}

        {pendingClubbedCount > 0 && isHost && (
          <span className="rounded-md bg-cyan/15 border border-cyan/40 px-2.5 py-1 text-xs font-bold tracking-wider text-cyan">
            {pendingClubbedCount} Question(s) in this batch
          </span>
        )}
      </div>

      {/* Main Question / Clue / Execution Problem */}
      <div className="w-full max-w-3xl space-y-3">
        <p className="text-xl sm:text-2xl md:text-3xl font-extrabold leading-snug tracking-tight">
          {item.clue || shown.clue}
        </p>

        {/* Code Snippet Box (if execution question) */}
        {item.codeSnippet && (
          <div
            className={`mx-auto max-w-lg rounded-xl p-3 text-left font-mono text-xs sm:text-sm border shadow-inner ${
              isLight
                ? 'bg-slate-900 text-emerald-400 border-slate-800'
                : 'bg-black/70 text-lime border-edge'
            }`}
          >
            <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-400">Code Execution:</div>
            <pre className="overflow-x-auto whitespace-pre-wrap">{item.codeSnippet}</pre>
          </div>
        )}
      </div>

      {/* Answer Area */}
      {isRevealed ? (
        <div className="animate-pop space-y-1">
          <p className="text-xs uppercase tracking-widest text-slate-500">Official Term / Answer</p>
          <div className="inline-block rounded-2xl bg-cyan/15 border-2 border-cyan/60 px-6 py-2 shadow-lg">
            <p className="text-3xl sm:text-4xl md:text-5xl font-black text-cyan tracking-tight">
              {item.term}
            </p>
          </div>
          <p className="text-xs text-slate-500">Mark #{shown.number} on your ticket!</p>
        </div>
      ) : (
        <div className="space-y-1">
          {isHost ? (
            <div className="rounded-xl border border-dashed border-amber/60 bg-amber/10 p-3 max-w-md mx-auto">
              <p className="text-xs font-bold uppercase tracking-wider text-amber">
                Host Preview (Hidden from players)
              </p>
              <p className="text-xl font-black text-amber-500 dark:text-amber-300">
                Answer: {item.term} (#{shown.number})
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Players see only the question. Reveal now or call more questions to club them!
              </p>
            </div>
          ) : (
            <p className="text-sm font-semibold text-cyan animate-pulse">
              💡 Know the answer? Find & tap it on your ticket before the host reveals!
            </p>
          )}
        </div>
      )}

      {/* Host Control Actions */}
      {isHost && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {!isRevealed && onRevealNow && (
            <button
              type="button"
              onClick={() => {
                play('reveal')
                stopSpeaking()
                onRevealNow()
              }}
              className="btn btn-primary text-xs font-bold px-4 py-2"
            >
              Reveal Answer Now
            </button>
          )}

          {onNextQuestion && (
            <button
              type="button"
              onClick={onNextQuestion}
              className="btn text-xs font-bold px-4 py-2"
            >
              {isRevealed ? 'Call Next Question' : 'Next Question (Club Batch)'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
