import type { ClaimType, GameStatus, Settings, Ticket } from '../../shared/types'

export interface GameRecord {
  account_user_id?: string
  id: string
  code: string
  status: GameStatus
  host_token_hash: string
  next_seq: number
  settings: Settings
  paused_from_status: GameStatus | null
  created_at: Date
}

export interface PlayerRecord {
  account_user_id?: string | null
  id: string
  game_id: string
  display_name: string
  is_host: boolean
  score: number
  wrong_claims: number
}

export interface TicketRecord {
  id: string
  cells: Ticket
  marked: number[]
  cut: number[]
}

export const claimTypes = ['early_five', 'four_corners', 'top_line', 'middle_line', 'bottom_line', 'full_house', 'second_full_house'] as const satisfies readonly ClaimType[]
