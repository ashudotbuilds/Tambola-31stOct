'use client'

import { useState, useMemo, useEffect } from 'react'
import { Ticket } from '@/lib/types'
import { TechnicalItem, getTechnicalItem } from '@/lib/technicalBank'
import { play } from '@/lib/sound'
import { useTheme } from '@/lib/theme'

interface LobbyTutorialSimulatorProps {
  ticket: Ticket | null
  playerMarked: Set<number>
  onToggleCell: (cell: number) => void
  customBank?: TechnicalItem[]
}

type TutorialStep = 'intro' | 'solve_clue' | 'unselect' | 'claims' | 'sandbox'

export function LobbyTutorialSimulator({
  ticket,
  playerMarked,
  onToggleCell,
  customBank,
}: LobbyTutorialSimulatorProps) {
  const { theme } = useTheme()
  const isLight = theme === 'light'

  // Extract all 15 valid numbers from player's ticket
  const ticketNumbers = useMemo(() => {
    if (!ticket) return []
    return ticket.flat().filter((n): n is number => n !== null)
  }, [ticket])

  // Select 3 sample items present on the user's actual ticket
  const sampleItems = useMemo(() => {
    if (ticketNumbers.length === 0) return []
    const first = ticketNumbers[0]
    const second = ticketNumbers[Math.min(5, ticketNumbers.length - 1)]
    const third = ticketNumbers[Math.min(10, ticketNumbers.length - 1)]
    return [
      getTechnicalItem(first, customBank),
      getTechnicalItem(second, customBank),
      getTechnicalItem(third, customBank),
    ]
  }, [ticketNumbers, customBank])

  const target1 = sampleItems[0]
  const target2 = sampleItems[1]

  const [step, setStep] = useState<TutorialStep>('intro')
  const [minimized, setMinimized] = useState(false)
  const [showHint, setShowHint] = useState(false)

  // Sandbox simulation state
  const [sandboxActive, setSandboxActive] = useState(false)
  const [sandboxCallIndex, setSandboxCallIndex] = useState(0)
  const [sandboxCalls, setSandboxCalls] = useState<TechnicalItem[]>([])
  const [sandboxClaimFeedback, setSandboxClaimFeedback] = useState<string | null>(null)

  // Track if target1 was marked
  const isTarget1Marked = target1 ? playerMarked.has(target1.id) : false

  // Play celebration sound when target1 is marked during solve_clue step
  useEffect(() => {
    if (step === 'solve_clue' && isTarget1Marked) {
      play('accept')
    }
  }, [step, isTarget1Marked])

  // Initialize sandbox with 3 items (2 from ticket, 1 not on ticket to teach discrimination!)
  function startSandbox() {
    if (ticketNumbers.length === 0) return
    // Pick 2 from ticket
    const onTicket1 = getTechnicalItem(ticketNumbers[0], customBank)
    const onTicket2 = getTechnicalItem(ticketNumbers[1] || ticketNumbers[0], customBank)
    // Find one item NOT on ticket
    const offTicketId = Array.from({ length: 90 }, (_, i) => i + 1).find(
      (n) => !ticketNumbers.includes(n),
    ) ?? 89
    const offTicket = getTechnicalItem(offTicketId, customBank)

    const calls = [onTicket1, offTicket, onTicket2]
    setSandboxCalls(calls)
    setSandboxCallIndex(0)
    setSandboxActive(true)
    setSandboxClaimFeedback(null)
    play('call')
  }

  function advanceSandboxCall() {
    if (sandboxCallIndex < sandboxCalls.length - 1) {
      setSandboxCallIndex((prev) => prev + 1)
      play('call')
    }
  }

  function testSandboxClaim() {
    if (!sandboxActive || sandboxCalls.length === 0) return

    // Valid called numbers so far
    const calledSoFar = new Set(sandboxCalls.slice(0, sandboxCallIndex + 1).map((c) => c.id))

    // Check player's marks that match called
    const validMarks = Array.from(playerMarked).filter((n) => calledSoFar.has(n))
    const bogusMarks = Array.from(playerMarked).filter((n) => !calledSoFar.has(n))

    if (bogusMarks.length > 0) {
      play('reject')
      setSandboxClaimFeedback(
        `❌ Bogus Claim! You marked item #${bogusMarks[0]} which has NOT been called yet. In the real game, this results in a -10 point penalty! Tap it again to unmark.`,
      )
    } else if (validMarks.length >= 1) {
      play('win')
      setSandboxClaimFeedback(
        `🎉 Valid Practice Claim! You accurately marked ${validMarks.length} called item(s) with zero bogus marks. You're ready for the host to start!`,
      )
    } else {
      play('reject')
      setSandboxClaimFeedback(
        `⚠️ No called items marked yet! Find the answer to the current clue on your ticket and tap it first.`,
      )
    }
  }

  if (minimized) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-cyan/40 bg-cyan/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base">🎓</span>
          <span className="text-xs font-bold text-cyan">How to Play Tutorial & Practice Arena</span>
        </div>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="btn px-2.5 py-1 text-xs font-semibold text-cyan hover:bg-cyan/20"
        >
          Expand Tutorial ▾
        </button>
      </div>
    )
  }

  return (
    <section
      className={`card relative overflow-hidden rounded-2xl border p-4 sm:p-5 shadow-lg transition-all ${
        isLight
          ? 'border-indigo-200 bg-gradient-to-br from-indigo-50/90 via-white to-sky-50/70 text-slate-800'
          : 'border-cyan/50 bg-gradient-to-br from-slate-900/90 via-panel to-slate-950/90 text-slate-100'
      }`}
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge/40 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan/20 text-sm">
            💡
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-black tracking-tight text-slate-900 dark:text-white">
                How to Play Simulator
              </h2>
              <span className="rounded-full bg-cyan/20 px-2 py-0.5 text-[10px] font-bold text-cyan">
                Interactive Lobby
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Master Technical Tambola while waiting for the host to begin!
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMinimized(true)}
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          title="Minimize tutorial"
        >
          Hide ▴
        </button>
      </div>

      {/* Step Tabs Navigation */}
      <div className="mt-3 flex overflow-x-auto no-scrollbar gap-1.5 pb-1 text-xs">
        <button
          type="button"
          onClick={() => setStep('intro')}
          className={`px-3 py-1.5 rounded-lg font-bold whitespace-nowrap transition-all ${
            step === 'intro'
              ? 'bg-cyan text-ink shadow-sm'
              : 'bg-ink/20 dark:bg-white/5 text-slate-400 hover:text-slate-200'
          }`}
        >
          1. The Rules
        </button>
        <button
          type="button"
          onClick={() => setStep('solve_clue')}
          className={`px-3 py-1.5 rounded-lg font-bold whitespace-nowrap transition-all ${
            step === 'solve_clue'
              ? 'bg-cyan text-ink shadow-sm'
              : 'bg-ink/20 dark:bg-white/5 text-slate-400 hover:text-slate-200'
          }`}
        >
          2. Try a Clue {isTarget1Marked ? '✓' : ''}
        </button>
        <button
          type="button"
          onClick={() => setStep('unselect')}
          className={`px-3 py-1.5 rounded-lg font-bold whitespace-nowrap transition-all ${
            step === 'unselect'
              ? 'bg-cyan text-ink shadow-sm'
              : 'bg-ink/20 dark:bg-white/5 text-slate-400 hover:text-slate-200'
          }`}
        >
          3. Tap & Unselect
        </button>
        <button
          type="button"
          onClick={() => setStep('claims')}
          className={`px-3 py-1.5 rounded-lg font-bold whitespace-nowrap transition-all ${
            step === 'claims'
              ? 'bg-cyan text-ink shadow-sm'
              : 'bg-ink/20 dark:bg-white/5 text-slate-400 hover:text-slate-200'
          }`}
        >
          4. Winning Claims
        </button>
        <button
          type="button"
          onClick={() => {
            setStep('sandbox')
            if (!sandboxActive) startSandbox()
          }}
          className={`px-3 py-1.5 rounded-lg font-bold whitespace-nowrap transition-all ${
            step === 'sandbox'
              ? 'bg-purple-500 text-white shadow-sm'
              : 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20'
          }`}
        >
          5. 🎮 Practice Match
        </button>
      </div>

      {/* Step 1: The Core Rules */}
      {step === 'intro' && (
        <div className="mt-3.5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-edge/60 bg-ink/30 dark:bg-black/20 p-3">
              <span className="text-xl">🧠</span>
              <h3 className="mt-1 font-bold text-xs uppercase tracking-wider text-cyan">
                1. Clues, Not Numbers
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                The host presents Computer Science puzzles, acronyms, or code execution outputs instead of raw numbers.
              </p>
            </div>

            <div className="rounded-xl border border-edge/60 bg-ink/30 dark:bg-black/20 p-3">
              <span className="text-xl">👆</span>
              <h3 className="mt-1 font-bold text-xs uppercase tracking-wider text-lime">
                2. Tap to Mark & Unmark
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                No auto-daubing! You must use your CS knowledge to find the answer on your ticket and tap it yourself.
              </p>
            </div>

            <div className="rounded-xl border border-edge/60 bg-ink/30 dark:bg-black/20 p-3">
              <span className="text-xl">⚡</span>
              <h3 className="mt-1 font-bold text-xs uppercase tracking-wider text-amber">
                3. Beware Bogus Claims
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Claiming a line or pattern with items that weren't officially called incurs a <b>-10 point penalty</b>!
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => setStep('solve_clue')}
              className="btn btn-primary text-xs font-bold px-4 py-2"
            >
              Next: Try a Practice Clue ➔
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Interactive Solve & Tap */}
      {step === 'solve_clue' && target1 && (
        <div className="mt-3.5 space-y-3">
          <div
            className={`rounded-xl border p-3.5 transition-all ${
              isTarget1Marked
                ? 'border-emerald-400/80 bg-emerald-500/10 dark:bg-emerald-950/30'
                : 'border-amber/50 bg-amber/10'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber">
                Simulated Clue #{target1.id} [{target1.category}]
              </span>
              {isTarget1Marked ? (
                <span className="text-xs font-black text-lime animate-bounce">
                  ✓ Found and Marked!
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-slate-400">
                  Target is on your ticket
                </span>
              )}
            </div>

            <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
              "{target1.clue}"
            </p>

            {target1.codeSnippet && (
              <pre className="mt-2 p-2 rounded bg-black/80 text-lime font-mono text-xs overflow-x-auto">
                {target1.codeSnippet}
              </pre>
            )}

            {/* Instruction box */}
            <div className="mt-3 pt-2.5 border-t border-edge/30 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{isTarget1Marked ? '🎉' : '👉'}</span>
                <p className="text-xs font-medium">
                  {isTarget1Marked ? (
                    <span className="text-lime font-bold">
                      Great job! You located "{target1.term}" on your ticket and tapped it.
                    </span>
                  ) : (
                    <span>
                      Look at your ticket below! Find <b>"{target1.term}"</b> and tap it to mark.
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {!isTarget1Marked && (
                  <button
                    type="button"
                    onClick={() => setShowHint((prev) => !prev)}
                    className="text-[11px] underline text-slate-400 hover:text-cyan"
                  >
                    {showHint ? `Answer: ${target1.term}` : 'Show Hint'}
                  </button>
                )}
                {isTarget1Marked ? (
                  <button
                    type="button"
                    onClick={() => setStep('unselect')}
                    className="btn btn-primary text-xs font-bold px-3 py-1.5"
                  >
                    Next: Try Unselecting ➔
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onToggleCell(target1.id)}
                    className="btn text-xs font-bold px-3 py-1.5 text-cyan hover:bg-cyan/10"
                    title="Simulate tapping this cell"
                  >
                    Simulate Tap
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Tap Again to Unselect */}
      {step === 'unselect' && target1 && (
        <div className="mt-3.5 space-y-3">
          <div className="rounded-xl border border-cyan/40 bg-cyan/10 p-3.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan mb-1">
              🔄 Full Manual Control: Unselect Mechanic
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-300 leading-relaxed">
              In Technical Tambola, tickets never auto-select. If you accidentally tap the wrong term or misinterpret a clue, simply <b>tap the cell a second time</b> to unmark it.
            </p>

            <div className="mt-3 flex items-center justify-between p-2.5 rounded-lg bg-ink/40 border border-edge/60 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono text-cyan font-bold">#{target1.id}</span>
                <span className="font-semibold">{target1.term}</span>
                <span className="text-slate-400">
                  Status: {isTarget1Marked ? '✅ Marked' : '⚪ Unmarked'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onToggleCell(target1.id)}
                className="btn px-2.5 py-1 text-xs font-bold text-amber hover:bg-amber/10"
              >
                {isTarget1Marked ? 'Tap to Unmark' : 'Tap to Mark'}
              </button>
            </div>
          </div>

          <div className="flex justify-between items-center pt-1">
            <button
              type="button"
              onClick={() => setStep('solve_clue')}
              className="btn text-xs px-3 py-1.5 text-slate-400"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setStep('claims')}
              className="btn btn-primary text-xs font-bold px-4 py-2"
            >
              Next: How Winning Claims Work ➔
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Winning Claims Guide */}
      {step === 'claims' && (
        <div className="mt-3.5 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3 text-xs">
            <div className="p-2.5 rounded-xl border border-edge/60 bg-ink/30">
              <p className="font-bold text-cyan">⚡ Early 5</p>
              <p className="text-slate-400 text-[11px] mt-0.5">First player to mark any 5 valid called numbers.</p>
            </div>
            <div className="p-2.5 rounded-xl border border-edge/60 bg-ink/30">
              <p className="font-bold text-cyan">📐 Four Corners</p>
              <p className="text-slate-400 text-[11px] mt-0.5">The 4 outermost numbers (top-left, top-right, bottom-left, bottom-right).</p>
            </div>
            <div className="p-2.5 rounded-xl border border-edge/60 bg-ink/30">
              <p className="font-bold text-cyan">➖ Lines (Top, Mid, Bottom)</p>
              <p className="text-slate-400 text-[11px] mt-0.5">All 5 numbers in row 1, row 2, or row 3.</p>
            </div>
          </div>

          <div className="rounded-xl border border-rose/40 bg-rose/10 p-3 text-xs">
            <p className="font-bold text-rose">🚨 Crucial Fair Play Rule:</p>
            <p className="text-slate-400 text-[11px] mt-0.5 leading-relaxed">
              When you press a Claim button, the backend server verifies that every single number in your claimed pattern was <b>officially called by the host</b>. Marking numbers that weren't called will reject the claim, deduct 10 points, and cut your ticket cell!
            </p>
          </div>

          <div className="flex justify-between items-center pt-1">
            <button
              type="button"
              onClick={() => setStep('unselect')}
              className="btn text-xs px-3 py-1.5 text-slate-400"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('sandbox')
                if (!sandboxActive) startSandbox()
              }}
              className="btn btn-primary text-xs font-bold px-4 py-2"
            >
              Start Practice Match 🎮
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Practice Match Sandbox */}
      {step === 'sandbox' && (
        <div className="mt-3.5 space-y-3">
          {sandboxCalls.length > 0 && (
            <div className="rounded-xl border border-purple-500/40 bg-purple-500/10 p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-500/30 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-purple-500/30 text-purple-200">
                    Practice Question {sandboxCallIndex + 1} of {sandboxCalls.length}
                  </span>
                  <span className="text-[11px] text-purple-300 font-semibold">
                    {sandboxCalls[sandboxCallIndex].category}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {sandboxCallIndex < sandboxCalls.length - 1 ? (
                    <button
                      type="button"
                      onClick={advanceSandboxCall}
                      className="btn px-2.5 py-1 text-xs font-bold text-cyan hover:bg-cyan/10"
                    >
                      Call Next Practice Clue ➔
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startSandbox}
                      className="btn px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200"
                    >
                      Restart Practice
                    </button>
                  )}
                </div>
              </div>

              {/* Practice Clue details */}
              <div className="space-y-1.5">
                <p className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                  "{sandboxCalls[sandboxCallIndex].clue}"
                </p>

                {sandboxCalls[sandboxCallIndex].codeSnippet && (
                  <pre className="p-2 rounded bg-black/80 text-lime font-mono text-xs overflow-x-auto">
                    {sandboxCalls[sandboxCallIndex].codeSnippet}
                  </pre>
                )}

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  <span>
                    Answer:{' '}
                    <strong className="text-cyan">{sandboxCalls[sandboxCallIndex].term}</strong>
                    {ticketNumbers.includes(sandboxCalls[sandboxCallIndex].id) ? (
                      <span className="ml-1 text-emerald-400 font-semibold">(On your ticket!)</span>
                    ) : (
                      <span className="ml-1 text-amber-400 font-semibold">(Not on your ticket — don't mark!)</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Practice Claim Action */}
              <div className="pt-2 border-t border-purple-500/20 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-400">
                  Currently marked on your ticket: <b>{playerMarked.size} cells</b>
                </p>
                <button
                  type="button"
                  onClick={testSandboxClaim}
                  className="btn btn-primary text-xs font-bold px-3 py-1.5"
                >
                  Test Practice Claim
                </button>
              </div>

              {sandboxClaimFeedback && (
                <div
                  className={`p-2.5 rounded-lg text-xs font-medium border animate-pop ${
                    sandboxClaimFeedback.includes('Valid')
                      ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                      : 'border-rose/50 bg-rose/10 text-rose'
                  }`}
                >
                  {sandboxClaimFeedback}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
