'use client'

import { useState } from 'react'
import {
  DEFAULT_TECHNICAL_BANK,
  exportBankToJson,
  parseCustomQuestions,
  type TechnicalItem,
} from '@/lib/technicalBank'
import { useTheme } from '@/lib/theme'

interface Props {
  isOpen: boolean
  onClose: () => void
  currentBank: TechnicalItem[]
  onSaveBank: (bank: TechnicalItem[]) => void
}

export function QuestionBankModal({ isOpen, onClose, currentBank, onSaveBank }: Props) {
  const { theme } = useTheme()
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [search, setSearch] = useState('')
  const [editText, setEditText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!isOpen) return null

  const isLight = theme === 'light'
  const filtered = currentBank.filter(
    (item) =>
      item.term.toLowerCase().includes(search.toLowerCase()) ||
      item.clue.toLowerCase().includes(search.toLowerCase()) ||
      item.category.toLowerCase().includes(search.toLowerCase()) ||
      String(item.id) === search.trim(),
  )

  const handleStartEdit = () => {
    // Format current bank as editable "Term | Clue"
    const lines = currentBank.map((item) => `${item.term} | ${item.clue}`).join('\n')
    setEditText(lines)
    setMode('edit')
    setError(null)
    setSuccess(null)
  }

  const handleApplyCustom = () => {
    setError(null)
    const result = parseCustomQuestions(editText)
    if (result.error) {
      setError(result.error)
      return
    }
    onSaveBank(result.items)
    setSuccess(`Successfully updated ${result.items.length} questions!`)
    setTimeout(() => {
      setMode('view')
      setSuccess(null)
    }, 1200)
  }

  const handleResetDefault = () => {
    if (confirm('Reset to the default ACM Engineering Day Technical Tambola bank?')) {
      onSaveBank(DEFAULT_TECHNICAL_BANK)
      setSuccess('Reset to default ACM technical questions bank!')
      setTimeout(() => setSuccess(null), 2000)
    }
  }

  const handleExport = () => {
    const json = exportBankToJson(currentBank)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `technical-tambola-bank-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className={`card flex flex-col max-h-[90vh] w-full max-w-4xl overflow-hidden p-6 shadow-2xl ${
          isLight ? 'bg-white border-slate-200' : 'bg-panel border-edge'
        }`}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 border-edge/60">
          <div>
            <h2 className="text-xl font-black flex items-center gap-2">
              <span>⚡ Technical Questions Bank</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan/15 text-cyan border border-cyan/40">
                {currentBank.length} Items
              </span>
            </h2>
            <p className="text-xs text-slate-500">
              Manage the technical terms, code snippets, and execution clues used in the game.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {mode === 'view' ? (
              <>
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="btn btn-primary text-xs py-1.5 px-3"
                >
                  Edit / Paste List
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  className="btn text-xs py-1.5 px-3"
                  title="Export questions as JSON"
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={handleResetDefault}
                  className="btn text-xs py-1.5 px-3 text-rose hover:border-rose/50"
                  title="Reset to default ACM question set"
                >
                  Reset
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setMode('view')}
                className="btn text-xs py-1.5 px-3"
              >
                Back to View
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:text-slate-100 hover:bg-ink/50"
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Notifications */}
        {error && (
          <div className="mt-3 rounded-xl border border-rose/50 bg-rose/10 px-4 py-2 text-xs text-rose">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-3 rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-600 dark:text-lime">
            {success}
          </div>
        )}

        {/* Content Body */}
        {mode === 'view' ? (
          <div className="flex flex-col flex-1 overflow-hidden mt-4 gap-3">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search term, clue, category, or ID #..."
                className="field text-sm py-2"
              />
              <span className="text-xs text-slate-400 whitespace-nowrap">
                {filtered.length} matching
              </span>
            </div>

            <div className="overflow-y-auto space-y-2 pr-1 max-h-[55vh]">
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isLight
                      ? 'border-slate-200 bg-slate-50/80 hover:bg-slate-100'
                      : 'border-edge bg-ink/40 hover:bg-ink/70'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan/15 text-cyan text-xs font-mono font-bold">
                      {item.id}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-cyan">{item.term}</span>
                        <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-panel border border-edge text-slate-400">
                          {item.category}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{item.clue}</p>
                      {item.codeSnippet && (
                        <pre className="mt-1.5 rounded p-2 text-[11px] font-mono bg-black/60 text-emerald-400 overflow-x-auto">
                          {item.codeSnippet}
                        </pre>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden mt-4 gap-3">
            <p className="text-xs text-slate-400">
              Paste your custom questions below. You can enter one question per line as{' '}
              <code className="bg-ink px-1 rounded text-cyan">Term | Question / Clue</code> or paste a valid JSON array.
            </p>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={16}
              className="field font-mono text-xs p-3 flex-1 resize-none"
              placeholder={`AWS | Leading cloud computing platform by Amazon\nBinary Large Object | What does BLOB stand for?\nVitalik Buterin | Co-founder of Ethereum\n20 10 | Output of: x = 20; y = 10; print(f"{x} {y}")`}
            />

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setMode('view')}
                className="btn text-xs py-2 px-4"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyCustom}
                className="btn btn-primary text-xs py-2 px-4 font-bold"
              >
                Apply Custom Questions
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
