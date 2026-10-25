import { useMemo, useState } from 'react'
import { Ticket } from './Ticket'
import { getTechnicalItem, type TechnicalItem } from '@/lib/technicalBank'
import type { Ticket as TicketType } from '@/lib/types'

export function LobbyTutorialSimulator({ ticket, customBank }: { ticket: TicketType | null; customBank?: TechnicalItem[] | null }) {
  // Separate ticket and local marks; practice never saves to the API.
  const demo = useMemo(() => {
    const excluded = new Set(ticket?.flat().filter(n => n !== null) ?? [])
    const pattern = [[0, 2, 4, 6, 8], [1, 3, 5, 7, 8], [0, 2, 4, 6, 7]]
    const used = new Set<number>()
    return pattern.map(cols => Array.from({ length: 9 }, (_, col) => {
      if (!cols.includes(col)) return null
      const start = col === 0 ? 1 : col * 10
      const end = col === 8 ? 90 : col * 10 + 9
      const value = Array.from({ length: end - start + 1 }, (_, i) => start + i).find(n => !excluded.has(n) && !used.has(n))!
      used.add(value)
      return value
    }))
  }, [ticket])
  const [marked, setMarked] = useState<Set<number>>(new Set())
  const [step, setStep] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const order = demo.flat().filter((n): n is number => n !== null)
  const item = step > 0 ? getTechnicalItem(order[step - 1], customBank) : null

  return <section className="card space-y-4 p-4 sm:p-6" aria-label="Interactive ticket simulation">
    <div className="flex flex-wrap items-center gap-3"><span className="border border-cyan bg-cyan/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-cyan">Practice</span><h2 className="text-lg font-bold">Interactive Ticket Simulation</h2></div>
    <p className="text-sm leading-relaxed text-slate-400">Try this sample ticket while you wait. Your real ticket is different and appears when the host starts. Practice marks stay here.</p>
    <div className="rounded-lg border border-edge p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-4">
        <div><p className="eyebrow text-cyan">Interactive demo</p><p className="mt-1 text-sm">Solve a clue, then tap its answer yourself.</p></div>
        <div className="flex w-full gap-2 sm:w-auto"><button className="btn btn-primary flex-1" disabled={step === order.length} onClick={() => { setStep(s => s + 1); setRevealed(false) }}>Simulate Next Clue</button><button className="btn" onClick={() => { setStep(0); setMarked(new Set()); setRevealed(false) }}>Reset</button></div>
      </div>
      <div className="my-4" role="status" aria-live="polite">
        {item ? <><p className="eyebrow">Practice clue #{step}</p><p className="mt-2 text-sm font-semibold">{item.clue}</p>{item.codeSnippet && <pre className="mt-2 overflow-x-auto bg-ink p-3 text-xs text-lime">{item.codeSnippet}</pre>}
          {revealed ? <p className="mt-2 font-bold text-cyan">Answer: {item.term}</p> : <button className="btn mt-3 text-xs" onClick={() => setRevealed(true)}>Reveal practice answer</button>}</> : <p className="text-sm text-slate-400">Tap cells to try marking, or simulate your first clue.</p>}
      </div>
      <p className="eyebrow mb-2 text-cyan">Sample practice ticket · demo only</p>
      <Ticket label="Practice ticket" ticket={demo} playerMarked={marked} cut={new Set()} customBank={customBank} onToggleCell={n => setMarked(previous => { const next = new Set(previous); if (next.has(n)) next.delete(n); else next.add(n); return next })} />
      <p className="mt-4 text-xs leading-relaxed text-slate-400">In the game, choose a claim yourself when you complete a pattern. Incorrect claims give a warning and notify the host, with no points deducted or cells cut.</p>
    </div>
  </section>
}
