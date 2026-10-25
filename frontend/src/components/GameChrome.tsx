import type { ReactNode } from 'react'
import { ArrowUpRight, Check, Grid3X3, MoveRight } from 'lucide-react'

export function GameHeader({ section, children }: { section?: string; children?: ReactNode }) {
  return <header className="game-header">
    <div className="min-w-0"><p className="game-wordmark">Technical Tambola</p>{section && <p className="eyebrow mt-1">{section}</p>}</div>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </header>
}

export function TicketPreview() {
  const terms = ['API', null, 'CSS', null, 'RAM', null, 'Git', null, 'SQL', null, 'CPU', null, 'HTML', 'DNS', null, 'Java', null, 'HTTP', 'Linux', null, 'React', null, null, 'Cache', null, 'Loop', 'Node']
  return <div className="ticket-preview" aria-hidden="true">
    <div className="flex items-center justify-between border-b border-edge pb-4 font-mono text-[10px] uppercase tracking-widest"><span className="flex items-center gap-2"><Grid3X3 size={14} /> Your next full house</span><span>3 × 9</span></div>
    <div className="mt-5 grid grid-cols-9 gap-1.5">{terms.map((term, i) => <span key={i} className={`preview-cell ${!term ? 'is-empty' : [0, 4, 12, 18, 26].includes(i) ? 'is-marked' : ''}`}>{term}{term && [0, 4, 12, 18, 26].includes(i) && <Check size={9} />}</span>)}</div>
    <div className="mt-5 flex items-center justify-between text-xs text-slate-400"><span>Know the answer. Mark your ticket.</span><ArrowUpRight size={16} className="text-cyan" /></div>
  </div>
}

export function PlaySteps() {
  return <ol className="play-steps" aria-label="How to play">{[['01', 'Solve', 'Crack the technical clue.'], ['02', 'Mark', 'Tap the answer on your ticket.'], ['03', 'Claim', 'Complete a pattern to win.']].map(([n, title, text]) => <li key={n}><span className="font-mono text-xs text-cyan">{n}</span><div><p className="font-display text-lg font-bold">{title}</p><p className="text-xs leading-relaxed text-slate-400">{text}</p></div><MoveRight size={14} className="ml-auto shrink-0 text-slate-500" aria-hidden="true" /></li>)}</ol>
}
