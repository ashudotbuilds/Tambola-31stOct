import type { ClaimType, Settings, Ticket } from './types'

export interface ClaimMeta {
  type: ClaimType
  label: string
  short: string
  blurb: string
}

export const CLAIMS: ClaimMeta[] = [
  { type: 'early_five', label: 'Early Five', short: 'E5', blurb: 'First five numbers on your ticket' },
  { type: 'four_corners', label: 'Four Corners', short: '4C', blurb: 'All four corner cells' },
  { type: 'top_line', label: 'Top Line', short: 'TL', blurb: 'Your whole first row' },
  { type: 'middle_line', label: 'Middle Line', short: 'ML', blurb: 'Your whole second row' },
  { type: 'bottom_line', label: 'Bottom Line', short: 'BL', blurb: 'Your whole third row' },
  { type: 'full_house', label: 'Full House', short: 'FH', blurb: 'All fifteen numbers' },
  { type: 'second_full_house', label: 'Second House', short: '2H', blurb: 'Another full house' },
]

export const DEFAULT_POINTS: Record<ClaimType, number> = {
  early_five: 10,
  four_corners: 20,
  top_line: 30,
  middle_line: 30,
  bottom_line: 30,
  full_house: 50,
  second_full_house: 30,
}

export function pointsFor(claim: ClaimType, settings?: Settings): number {
  return settings?.points?.[claim] ?? DEFAULT_POINTS[claim]
}

export function claimLabel(claim: ClaimType): string {
  return CLAIMS.find((c) => c.type === claim)?.label ?? claim
}

/** Every number printed on the ticket, in reading order. */
export function ticketNumbers(ticket: Ticket | null | undefined): number[] {
  if (!ticket) return []
  return ticket.flatMap((row) => row.filter((n): n is number => n !== null))
}

export function hasNumber(ticket: Ticket | null | undefined, n: number): boolean {
  if (!ticket) return false
  return ticket.some((row) => row.includes(n))
}

/**
 * Client-side mirror of the SQL function tambola_claim_ok().
 *
 * This only decides which claim buttons look tappable. The server re-evaluates
 * every claim against the stored ticket and is the only thing that awards points.
 */
export function isClaimEligible(
  claim: ClaimType,
  ticket: Ticket | null | undefined,
  marked: ReadonlySet<number>,
  cut: ReadonlySet<number>,
): boolean {
  if (!ticket) return false

  const ok = (n: number | null): boolean => n !== null && marked.has(n) && !cut.has(n)

  // A blank cell is not a number, so it must not block the line. Every row has
  // four blanks, so treating them as failures would make lines unclaimable.
  const rowComplete = (r: number): boolean => ticket[r].every((cell) => cell === null || ok(cell))

  switch (claim) {
    case 'early_five':
      return ticketNumbers(ticket).filter((n) => marked.has(n) && !cut.has(n)).length >= 5
    case 'four_corners':
      return ok(ticket[0][0]) && ok(ticket[0][8]) && ok(ticket[2][0]) && ok(ticket[2][8])
    case 'top_line':
      return rowComplete(0)
    case 'middle_line':
      return rowComplete(1)
    case 'bottom_line':
      return rowComplete(2)
    case 'full_house':
    case 'second_full_house':
      return ticketNumbers(ticket).every(ok)
    default:
      return false
  }
}

/** Shortfall hint so players know how far they are from a claim. */
export function claimProgress(
  claim: ClaimType,
  ticket: Ticket | null | undefined,
  marked: ReadonlySet<number>,
  cut: ReadonlySet<number>,
): { have: number; need: number } {
  const nums = ticketNumbers(ticket)
  const usable = nums.filter((n) => marked.has(n) && !cut.has(n)).length

  if (claim === 'early_five') return { have: usable, need: 5 }
  if (claim === 'full_house' || claim === 'second_full_house') return { have: usable, need: nums.length }
  if (claim === 'four_corners') {
    const corners: (number | null | undefined)[] = [
      ticket?.[0]?.[0],
      ticket?.[0]?.[8],
      ticket?.[2]?.[0],
      ticket?.[2]?.[8],
    ]
    const have = corners.filter(
      (n): n is number => n !== null && n !== undefined && marked.has(n) && !cut.has(n),
    ).length
    return { have, need: 4 }
  }
  const row = claim === 'top_line' ? 0 : claim === 'middle_line' ? 1 : 2
  const cells = (ticket?.[row] ?? []).filter((n): n is number => n !== null)
  return { have: cells.filter((n) => marked.has(n) && !cut.has(n)).length, need: cells.length }
}
