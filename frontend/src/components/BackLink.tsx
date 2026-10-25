import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

/** Explicit destinations keep direct links and new tabs inside the app. */
export function BackLink({ to, label = 'Back', text = 'Back' }: { to: string; label?: string; text?: string }) {
  return <Link to={to} aria-label={label} title={label} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-md border border-edge bg-panel px-2 py-1.5 text-xs font-semibold text-slate-300 hover:border-cyan hover:text-cyan">
    <ArrowLeft size={14} aria-hidden="true" /><span>{text}</span>
  </Link>
}
