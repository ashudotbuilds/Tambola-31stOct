export type GameStatus = 'lobby' | 'playing' | 'paused' | 'closing' | 'finished'

export type ClaimType =
  | 'early_five'
  | 'four_corners'
  | 'top_line'
  | 'middle_line'
  | 'bottom_line'
  | 'full_house'
  | 'second_full_house'

/** 3 rows x 9 columns. A null cell is a blank. */
export type Ticket = (number | null)[][]

export interface PlayerRow {
  id: string
  name: string
  is_host: boolean
  score: number
  wrong_claims: number
}

export interface CallRow {
  seq: number
  number: number
  clue: string
  called_at: string
}

export interface ClaimRow {
  id: string
  player_id: string
  name: string
  claim_type: ClaimType
  status: 'accepted' | 'rejected'
  points: number
  reason: string | null
  created_at: string
}

export interface Me {
  player_id: string
  name: string
  is_host: boolean
  score: number
  wrong_claims: number
  ticket: Ticket
  marked: number[]
  cut: number[]
}

export interface Settings {
  points?: Partial<Record<ClaimType, number>>
  wrong_claim_penalty?: number
  close_after_calls?: number
  max_players?: number
  reveal_seconds?: number
  pause_after_calls?: number
  closing_seq?: number
  /** First call in the visible batch. */
  /** Host-selected historical call shown to everyone; null follows the latest call. */
  display_seq?: number | null
  question_batch_start?: number
  revealed_seqs?: number[]
  custom_bank?: unknown
}

export interface GameState {
  ok: boolean
  error?: string
  game_id: string
  code: string
  status: GameStatus
  settings: Settings
  created_at?: string
  players: PlayerRow[]
  calls: CallRow[]
  claims: ClaimRow[]
  /** JSON null when the caller passed no token or the token is unknown. */
  me: Me | null
}

export interface RpcFailure {
  ok: false
  error: string
}

/** Incremental calls and current mutable state; static ticket/bank stay on the client. */
export type GameUpdate = Omit<GameState, 'me' | 'settings'> & {
  settings: Omit<Settings, 'custom_bank'>
  me: Omit<Me, 'ticket'> | null
}

export type Rpc<T> = T | RpcFailure

export function isFailure(value: unknown): value is RpcFailure {
  return !!value && typeof value === 'object' && (value as { ok?: unknown }).ok === false
}

/** A session token pair as handed out by create_game / join_game. */
export interface HostSession {
  game_id: string
  code: string
  player_id: string
  display_name: string
  player_token: string
  host_token: string
}

export interface PlayerSession {
  game_id: string
  code: string
  player_id: string
  display_name: string
  player_token: string
}

export interface CreateGameResult extends HostSession {
  ok: true
  settings: Settings
  status: GameStatus
}

export interface JoinGameResult extends PlayerSession {
  ok: true
  settings: Settings
  status: GameStatus
  player_count: number
}

export interface DrawResult {
  ok: true
  seq: number
  number: number
  clue: string
  status: GameStatus
  called_count: number
}

export interface ClaimResult {
  ok: true
  accepted: boolean
  status: 'accepted' | 'rejected'
  reason: string | null
  points: number
  penalty?: number
  score?: number
  cut?: number | null
  wrong_claims?: number
  error?: string
  code?: string
}

/** UI events derived from refreshed state after Socket.IO invalidations. */
export interface NumberCalledEvent {
  game_id: string
  seq: number
  number: number
  clue: string
  called_at: string
}

export interface ClaimResultEvent {
  game_id: string
  id: string
  player_id: string
  name: string
  claim_type: ClaimType
  status: 'accepted' | 'rejected'
  points: number
  reason: string | null
  created_at: string
}

export interface ScoreboardEvent {
  game_id: string
  players: { id: string; name: string; score: number; is_host: boolean }[]
}

export interface StatusChangedEvent {
  game_id: string
  status: GameStatus
}

export interface PlayerJoinedEvent {
  game_id: string
  player_id: string
  name: string
  is_host: boolean
  player_count: number
}

export interface TicketUpdatedEvent {
  game_id: string
  player_id: string
}

/* Production Auth & Role types (PRD §5, §11, §39) */
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
export type AdminRole = 'ADMIN' | 'SUPER_ADMIN'
export type PrincipalType = 'PARTICIPANT' | 'ADMIN' | 'SUPER_ADMIN'

export interface AuthUser {
  id: string
  email: string
  name: string
  status: UserStatus
}

export interface AuthPrincipal {
  type: PrincipalType
  profileId: string
  role?: AdminRole
}

export interface LoginResult {
  ok: true
  user: AuthUser
  principal: AuthPrincipal
}

export interface AuthMeResult {
  ok: true
  user: AuthUser
  principal: AuthPrincipal
}
