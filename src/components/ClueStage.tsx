'use client'

import { useEffect, useRef, useState } from 'react'
import { play, speak, stopSpeaking } from '@/lib/sound'
import type { CallRow } from '@/lib/types'

export type CluePhase = 'idle' | 'clue' | 'revealed'

interface Props {
  /** The newest call, or null before the first one. */
  call: CallRow | null
  revealSeconds: number
  pauseSeconds: number
  speakClues: boolean
  onPhaseChange?: (phase: CluePhase) => void
  onReady?: () => void
}

export function ClueStage({
  call,
  revealSeconds,
  pauseSeconds,
  speakClues,
  onPhaseChange,
  onReady,
}: Props) {
  const [phase, setPhase] = useState<CluePhase>('idle')
  const [remaining, setRemaining] = useState(0)
  const [shown, setShown] = useState<CallRow | null>(null)
  const seqRef = useRef<number>(-1)

  // A new call arrives: show the clue and start the decode countdown.
  useEffect(() => {
    if (!call || call.seq === seqRef.current) return
    seqRef.current = call.seq
    setShown(call)
    setPhase('clue')
    setRemaining(revealSeconds)
    play('call')
    if (speakClues) speak(call.clue)
  }, [call, revealSeconds, speakClues])

  useEffect(() => {
    onPhaseChange?.(phase)
  }, [phase, onPhaseChange])

  // Clue countdown, then the reveal, then a short beat before the next call.
  useEffect(() => {
    if (phase === 'idle') return

    if (phase === 'clue') {
      if (remaining <= 0) {
        setPhase('revealed')
        setRemaining(pauseSeconds)
        play('reveal')
        stopSpeaking()
        return
      }
      const id = setTimeout(() => setRemaining((r) => r - 1), 1000)
      return () => clearTimeout(id)
    }

    if (phase === 'revealed') {
      if (remaining <= 0) {
        setPhase('idle')
        onReady?.()
        return
      }
      const id = setTimeout(() => setRemaining((r) => r - 1), 1000)
      return () => clearTimeout(id)
    }
  }, [phase, remaining, pauseSeconds, onReady])

  const skip = () => {
    if (phase === 'clue') {
      setPhase('revealed')
      setRemaining(pauseSeconds)
      play('reveal')
      stopSpeaking()
    } else if (phase === 'revealed') {
      setPhase('idle')
      onReady?.()
    }
  }

  if (phase === 'idle' || !shown) {
    return (
      <div className="card flex min-h-[220px] flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Awaiting call</p>
        <p className="max-w-sm text-sm text-slate-400">
          Press <span className="font-bold text-cyan">CALL NUMBER</span> to announce the next clue. Players get a
          few seconds to decode it before the number is revealed.
        </p>
      </div>
    )
  }

  return (
    <div className="card relative flex min-h-[220px] flex-col items-center justify-center gap-4 overflow-hidden p-6 text-center">
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-ink px-2 py-1 text-xs font-bold tabular-nums text-slate-400">
          #{shown.seq}
        </span>
        {phase === 'clue' ? (
          <span className="rounded-md bg-amber/20 px-2 py-1 text-xs font-bold uppercase tracking-wider text-amber">
            Decode in {remaining}s
          </span>
        ) : (
          <span className="rounded-md bg-cyan/20 px-2 py-1 text-xs font-bold uppercase tracking-wider text-cyan">
            Revealed
          </span>
        )}
      </div>

      {phase === 'clue' ? (
        <>
          <p className="max-w-2xl text-2xl font-black leading-tight sm:text-4xl">{shown.clue}</p>
          <p className="text-xs uppercase tracking-widest text-slate-500">What number is this?</p>
        </>
      ) : (
        <p className="animate-pop text-7xl font-black tabular-nums text-cyan sm:text-8xl">{shown.number}</p>
      )}

      <button type="button" onClick={skip} className="btn text-xs">
        {phase === 'clue' ? 'Reveal now' : 'Next call'}
      </button>
    </div>
  )
}
