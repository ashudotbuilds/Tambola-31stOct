import { randomInt } from 'node:crypto'
import { generateTicket } from '../games/ticket'

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/** Keep the established 3×9 layout and fill it with 15 distinct round keys. */
export function generateRoundTicket(keyIds: string[]): (string | null)[][] {
  if (keyIds.length < 15) throw new Error('At least 15 distinct keys are required')
  const numeric = generateTicket()
  const selected = shuffle([...keyIds]).slice(0, 15)
  const numbers = numeric.flat().filter((value): value is number => value !== null).sort((a, b) => a - b)
  const byNumber = new Map(numbers.map((number, index) => [number, selected[index]]))
  return numeric.map(row => row.map(number => number === null ? null : byNumber.get(number)!))
}
