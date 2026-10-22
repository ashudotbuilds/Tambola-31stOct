import { DEFAULT_TECHNICAL_BANK, type TechnicalItem } from '@tambola/shared/bank'
export { DEFAULT_TECHNICAL_BANK, type TechnicalItem } from '@tambola/shared/bank'

const CUSTOM_BANK_KEY = 'tt.custom_bank'

/** Lookup an item by its 1-90 ID from custom bank or default bank */
export function getTechnicalItem(id: number, customBank?: TechnicalItem[] | null): TechnicalItem {
  if (customBank && Array.isArray(customBank)) {
    const found = customBank.find((item) => item.id === id)
    if (found) return found
  }
  const defaultFound = DEFAULT_TECHNICAL_BANK.find((item) => item.id === id)
  if (defaultFound) return defaultFound
  return {
    id,
    term: `#${id}`,
    clue: `Clue for item #${id}`,
    category: 'General',
  }
}

/** Get the active bank: custom from storage if available, else default bank */
export function getActiveBank(customBank?: TechnicalItem[] | null): TechnicalItem[] {
  if (customBank && customBank.length > 0) return customBank
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(CUSTOM_BANK_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as TechnicalItem[]
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {
      // ignore
    }
  }
  return DEFAULT_TECHNICAL_BANK
}

/** Save custom bank to localStorage */
export function saveLocalCustomBank(bank: TechnicalItem[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CUSTOM_BANK_KEY, JSON.stringify(bank))
}

/** Clear custom bank from localStorage and revert to default */
export function resetLocalCustomBank(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(CUSTOM_BANK_KEY)
}

/**
 * Parses user-provided text into a 90-item bank.
 * Accepts:
 * 1. JSON array of { term, clue, category?, codeSnippet? }
 * 2. Delimited text lines: "Term | Clue" or "Term, Clue"
 */
export function parseCustomQuestions(text: string): { items: TechnicalItem[]; error?: string } {
  const trimmed = text.trim()
  if (!trimmed) return { items: [], error: 'Input is empty' }

  // Try JSON first
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed) as Array<Record<string, unknown>>
      if (!Array.isArray(parsed)) return { items: [], error: 'Expected a JSON array of questions' }
      const items: TechnicalItem[] = []
      for (let i = 0; i < 90; i++) {
        const entry = parsed[i]
        if (entry) {
          items.push({
            id: i + 1,
            term: String(entry.term ?? entry.answer ?? entry.name ?? `Item ${i + 1}`).trim(),
            clue: String(entry.clue ?? entry.question ?? entry.text ?? '').trim(),
            category: String(entry.category ?? 'Custom').trim(),
            codeSnippet: entry.codeSnippet ? String(entry.codeSnippet) : undefined,
          })
        } else {
          // Fill remainder with default
          items.push(DEFAULT_TECHNICAL_BANK[i])
        }
      }
      return { items }
    } catch (err) {
      return { items: [], error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  // Otherwise parse line by line
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))

  if (lines.length === 0) {
    return { items: [], error: 'No valid lines found' }
  }

  const items: TechnicalItem[] = []
  for (let i = 0; i < 90; i++) {
    if (i < lines.length) {
      const line = lines[i]
      let term = ''
      let clue = ''
      if (line.includes('|')) {
        const parts = line.split('|')
        term = parts[0].trim()
        clue = parts.slice(1).join('|').trim()
      } else if (line.includes(' - ')) {
        const parts = line.split(' - ')
        term = parts[0].trim()
        clue = parts.slice(1).join(' - ').trim()
      } else if (line.includes('\t')) {
        const parts = line.split('\t')
        term = parts[0].trim()
        clue = parts.slice(1).join(' ').trim()
      } else if (line.includes(',')) {
        const parts = line.split(',')
        term = parts[0].trim()
        clue = parts.slice(1).join(',').trim()
      } else {
        term = line
        clue = `Question for ${line}`
      }
      items.push({
        id: i + 1,
        term: term || `Item ${i + 1}`,
        clue: clue || `Clue for ${term}`,
        category: 'Custom',
      })
    } else {
      items.push(DEFAULT_TECHNICAL_BANK[i])
    }
  }

  return { items }
}

/** Export bank to downloadable JSON or copyable string */
export function exportBankToJson(bank: TechnicalItem[]): string {
  return JSON.stringify(bank, null, 2)
}
