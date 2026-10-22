import { randomInt } from 'node:crypto'
import type { Ticket } from '@tambola/shared/types'

function shuffle<T>(values: T[]): T[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[values[i], values[j]] = [values[j], values[i]]
  }
  return values
}

/** 15 distinct numbers, five per row, 1–3 per column, all four corners filled. */
export function generateTicket(): Ticket {
  const counts = [3, 1, 1, 1, 1, 1, 1, 1, 3]
  for (let extras = 2; extras > 0;) {
    const column = randomInt(1, 8)
    if (counts[column] < 3) { counts[column]++; extras-- }
  }
  const ticket: Ticket = Array.from({ length: 3 }, () => Array(9).fill(null))
  let position = randomInt(3)
  for (const column of shuffle(Array.from({ length: 9 }, (_, i) => i))) {
    const min = column === 0 ? 1 : column * 10
    const max = column === 8 ? 90 : column * 10 + 9
    const numbers = shuffle(Array.from({ length: max - min + 1 }, (_, i) => min + i))
      .slice(0, counts[column]).sort((a, b) => a - b)
    const rows = Array.from({ length: counts[column] }, () => position++ % 3).sort()
    rows.forEach((row, i) => { ticket[row][column] = numbers[i] })
  }
  return ticket
}
