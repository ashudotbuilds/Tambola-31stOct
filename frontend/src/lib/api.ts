import { request } from './http'
import { sessions } from './sessions'
import { getActiveBank } from './technicalBank'
import type {
  AuthMeResult,
  AuthUser,
  ClaimResult,
  ClaimType,
  CreateGameResult,
  DrawResult,
  GameState,
  JoinGameResult,
  LoginResult,
} from './types'
export { sessions } from './sessions'

export async function loginUser(email: string, password: string): Promise<LoginResult> {
  return request<LoginResult>('/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  })
}

export async function logoutUser(token?: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/v1/auth/logout', {
    method: 'POST',
    token,
  })
}

export async function getCurrentUser(token?: string): Promise<AuthMeResult> {
  return request<AuthMeResult>('/v1/auth/me', {
    method: 'GET',
    token,
  })
}

export async function bootstrapSuperAdmin(
  secret: string,
  email: string,
  name: string,
  password: string,
): Promise<{ ok: boolean; user: AuthUser; role: string }> {
  return request<{ ok: boolean; user: AuthUser; role: string }>('/v1/auth/bootstrap-super-admin', {
    method: 'POST',
    headers: { 'x-bootstrap-secret': secret },
    body: { email, name, password },
  })
}

export interface AdminAccount {
  id: string
  user_id: string
  role: 'ADMIN' | 'SUPER_ADMIN'
  name: string
  email: string
  created_at: string
  credential_status: 'PENDING'|'SENT'|'FAILED'|null
  credential_last_sent_at: string | null
}

export async function listAdminAccounts(): Promise<{ ok: true; admins: AdminAccount[] }> {
  return request('/v1/super-admin/admins')
}

export async function createAdminAccount(input: {
  email: string
  name: string
  role: 'ADMIN' | 'SUPER_ADMIN'
}): Promise<{ ok: true; user: AuthUser; role: 'ADMIN' | 'SUPER_ADMIN' }> {
  return request('/v1/super-admin/admins', { method: 'POST', body: input })
}
export async function regenerateAdminCredential(profileId: string) {
  return request(`/v1/super-admin/admins/${encodeURIComponent(profileId)}/credentials`, { method: 'POST', body: {} })
}

export async function deleteAdminAccount(profileId: string): Promise<{ ok: true }> {
  return request(`/v1/super-admin/admins/${encodeURIComponent(profileId)}`, { method: 'DELETE' })
}

export interface AdminEvent {
  id: string
  name: string
  description: string | null
  status: string
  created_at: string
  updated_at: string
  participant_count: number
}

export async function listEvents(): Promise<{ ok: true; events: AdminEvent[] }> {
  return request('/v1/admin/events')
}
export interface EventParticipant {
  profile_id: string
  name: string
  email: string
  account_status: 'ACTIVE'|'INACTIVE'|'SUSPENDED'
  external_id: string | null
  credential_status: 'NOT_ISSUED'|'PENDING'|'SENT'|'FAILED'
  last_sent_at: string | null
  attempts: number | null
}
export async function listEventParticipants(eventId: string): Promise<{ ok: true; participants: EventParticipant[] }> {
  return request(`/v1/admin/events/${encodeURIComponent(eventId)}/participants`)
}
export async function issueParticipantCredential(eventId: string, profileId: string): Promise<{ ok: true; credential_status: string; email: string }> {
  return request(`/v1/admin/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(profileId)}/credentials`, { method: 'POST', body: {} })
}

export async function createEvent(input: { name: string; description?: string }): Promise<{ ok: true; event: AdminEvent }> {
  return request('/v1/admin/events', { method: 'POST', body: input })
}

export interface ParticipantImportResult {
  ok: true
  created: number
  skipped: number
  failed: number
  rows: Array<{ row: number; status: 'created' | 'skipped' | 'failed'; message?: string }>
}

export async function importParticipants(eventId: string, csv: string): Promise<ParticipantImportResult> {
  return request(`/v1/admin/events/${encodeURIComponent(eventId)}/participants/import`, { method: 'POST', body: csv })
}

export interface AdminRound {
  id: string
  event_id: string
  round_no: number
  name: string
  status: string
  question_count: number
  ticket_count: number
  patterns: Array<{ pattern: string; enabled: boolean; max_winners: number; status: string }>
}

export interface EventKey { id: string; value: string; active: boolean }
export interface RoundQuestion { id: string; key_id: string; key: string; question: string; active: boolean }
export interface RoundDraw { id?: string; seq: number; key_id?: string; manual?: boolean; drawn_at?: string; revealed_at?: string | null; question?: string | null; key?: string | null }
export interface RoundAdminClaim { id: string; pattern: string; status: string; points: number; penalty: number; cut_cell_id: string | null; submitted_at: string; reviewed_at: string | null; reason: string | null; participant_name: string; participant_email: string }
export interface AdminRoundState {
  ok: true
  event: { id: string; name: string; status: string }
  round: { id: string; number: number; name: string; status: string }
  draws: RoundDraw[]
  winners: Array<{ pattern: string; name: string; verified_at: string }>
  pending_claims: number
  recovery: { validation_status: string; validation_issues: string[]; last_validated_at: string; detected_at: string; resolved_at: string | null } | null
  claims: RoundAdminClaim[]
}

export async function listRounds(eventId: string): Promise<{ ok: true; rounds: AdminRound[] }> {
  return request(`/v1/admin/events/${encodeURIComponent(eventId)}/rounds`)
}
export async function createRound(eventId: string, name: string): Promise<{ ok: true; round: { id: string } }> {
  return request(`/v1/admin/events/${encodeURIComponent(eventId)}/rounds`, { method: 'POST', body: { name } })
}
export async function listEventKeys(eventId: string): Promise<{ ok: true; keys: EventKey[] }> {
  return request(`/v1/admin/events/${encodeURIComponent(eventId)}/keys`)
}
export async function addEventKey(eventId: string, value: string): Promise<{ ok: true; key: EventKey }> {
  return request(`/v1/admin/events/${encodeURIComponent(eventId)}/keys`, { method: 'POST', body: { value } })
}
export async function listRoundQuestions(roundId: string): Promise<{ ok: true; questions: RoundQuestion[] }> {
  return request(`/v1/admin/rounds/${encodeURIComponent(roundId)}/questions`)
}
export async function addRoundQuestion(roundId: string, keyId: string, question: string): Promise<{ ok: true }> {
  return request(`/v1/admin/rounds/${encodeURIComponent(roundId)}/questions`, { method: 'POST', body: { keyId, question } })
}
export async function generateRoundTickets(roundId: string): Promise<{ ok: true; created: number; total: number }> {
  return request(`/v1/admin/rounds/${encodeURIComponent(roundId)}/tickets/generate`, { method: 'POST', body: {} })
}
export async function changeRoundStatus(roundId: string, action: 'ready'|'start'|'pause'|'resume'|'complete'|'cancel'): Promise<{ ok: true; status: string }> {
  return request(`/v1/admin/rounds/${encodeURIComponent(roundId)}/${action}`, { method: 'POST', body: {} })
}
export async function setRoundPattern(roundId: string, pattern: string, enabled: boolean, maxWinners: number) {
  return request(`/v1/admin/rounds/${encodeURIComponent(roundId)}/patterns/${encodeURIComponent(pattern)}`, {
    method: 'PATCH', body: { enabled, maxWinners },
  })
}
export async function getAdminRoundState(roundId: string): Promise<AdminRoundState> {
  return request(`/v1/admin/rounds/${encodeURIComponent(roundId)}/state`)
}
export async function drawRoundQuestion(roundId: string, keyId?: string) {
  return request<{ ok: true; draw: RoundDraw }>(`/v1/admin/rounds/${encodeURIComponent(roundId)}/draws`, { method: 'POST', body: keyId ? { keyId } : {} })
}
export async function revealRoundDraw(roundId: string, seq: number) {
  return request(`/v1/admin/rounds/${encodeURIComponent(roundId)}/draws/reveal`, { method: 'POST', body: { seq } })
}
export async function reviewRoundClaim(claimId: string, decision: 'verify'|'reject', reason?: string) {
  return request(`/v1/admin/claims/${encodeURIComponent(claimId)}/review`, { method: 'POST', body: { decision, reason } })
}

export interface ParticipantRoundInfo { id: string; round_no: number; name: string; status: string; has_ticket: boolean }
export async function listMyRounds(): Promise<{ ok: true; event: { id: string; name: string; status: string }; rounds: ParticipantRoundInfo[] }> {
  return request('/v1/participant/rounds')
}
export interface ParticipantRoundState {
  ok: true
  event: { id: string; name: string; status: string }
  round: { id: string; number: number; name: string; status: string }
  draws: RoundDraw[]
  winners: Array<{ pattern: string; name: string; verified_at: string }>
  ticket: { cells: Array<Array<{ id: string; value: string } | null>>; marked_cell_ids: string[]; cut_cell_ids: string[] }
  score: { score: number; wrong_claims: number }
  claims: Array<{ pattern: string; status: string; submitted_at: string; reviewed_at: string | null; reason: string | null; points: number; penalty: number; cut_cell_id: string | null }>
  patterns: Array<{ pattern: string; enabled: boolean; max_winners: number; status: string }>
}
export async function getMyRound(roundId: string): Promise<ParticipantRoundState> {
  return request(`/v1/participant/rounds/${encodeURIComponent(roundId)}`)
}
export async function markMyCell(roundId: string, keyId: string, marked: boolean): Promise<{ ok: true; marked_cell_ids: string[] }> {
  return marked
    ? request(`/v1/participant/rounds/${encodeURIComponent(roundId)}/marks`, { method: 'POST', body: { keyId } })
    : request(`/v1/participant/rounds/${encodeURIComponent(roundId)}/marks/${encodeURIComponent(keyId)}`, { method: 'DELETE' })
}
export async function submitMyClaim(roundId: string, pattern: string) {
  return request(`/v1/participant/rounds/${encodeURIComponent(roundId)}/claims`, { method: 'POST', body: { pattern } })
}
export async function getPublicRound(roundId: string) {
  return request<{ ok: true; event: { name: string }; round: { name: string; number: number; status: string }; draws: RoundDraw[]; winners: Array<{ pattern: string; name: string; points: number }>; standings: Array<{ name: string; score: number; wrong_claims: number }> }>(`/v1/public/rounds/${encodeURIComponent(roundId)}`)
}

export interface AdminDashboard {
  ok: true
  event: { id: string; name: string; status: string; updated_at: string } | null
  round: { id: string; round_no: number; name: string; status: string } | null
  counts: { participants: number; draws: number; pendingClaims: number; verifiedWinners: number }
  recoveryRequiredRounds: number
  socketConnections: number
}
export async function getAdminDashboard(): Promise<AdminDashboard> { return request('/v1/admin/dashboard') }
export interface AuditEntry { id: string; actorId: string | null; action: string; resourceType: string; resourceId: string | null; metadata: Record<string, unknown>; createdAt: string }
export async function listAudit(input: { cursor?: string; limit?: number; actorId?: string; action?: string; from?: string; to?: string } = {}): Promise<{ ok: true; entries: AuditEntry[]; nextCursor: string | null }> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') query.set(key, String(value))
  return request(`/v1/admin/audit${query.size ? `?${query}` : ''}`)
}
export async function getSystemDiagnostics(): Promise<{ ok: true; version: string | null; nodeVersion: string; readiness: boolean | null; recoveryRequiredRounds: number | null; latestMigration: string | null }> {
  return request('/v1/super-admin/system')
}
export async function recoverRound(roundId: string): Promise<{ ok: true; status: string }> {
  return request(`/v1/super-admin/rounds/${encodeURIComponent(roundId)}/recover`, { method: 'POST', body: {} })
}


export async function createGame(hostName: string): Promise<CreateGameResult> {
  const result = await request<CreateGameResult>('/games', { method: 'POST', body: { hostName: hostName.trim(), bank: getActiveBank() } })
  sessions.saveHost({ game_id: result.game_id, code: result.code, player_id: result.player_id,
    display_name: result.display_name, player_token: result.player_token, host_token: result.host_token })
  return result
}
export async function listAccountGames() {
  return request<{ok:true;games:Array<{id:string;code:string;status:string;created_at:string}>}>('/games')
}
export async function resumeAccountGame(gameId:string) {
  const result=await request<CreateGameResult>(`/games/${encodeURIComponent(gameId)}/session`,{method:'POST',body:{}})
  sessions.saveHost({game_id:result.game_id,code:result.code,player_id:result.player_id,display_name:result.display_name,player_token:result.player_token,host_token:result.host_token})
  return result
}
export async function joinGame(code: string, name: string): Promise<JoinGameResult> {
  const result = await request<JoinGameResult>('/games/join', { method: 'POST', body: { code: code.trim().toUpperCase(), name: name.trim() } })
  sessions.savePlayer({ game_id: result.game_id, code: result.code, player_id: result.player_id,
    display_name: result.display_name, player_token: result.player_token })
  return result
}
export const getGameState = (gameId: string, token?: string | null) => request<GameState>(`/games/${gameId}`, { token })
export const getGameStateByCode = (code: string) => request<GameState>(`/games/code/${encodeURIComponent(code.trim().toUpperCase())}`)
export const startGame = (gameId: string, token: string) => request<{ status: string }>(`/games/${gameId}/start`, { method: 'POST', token })
export const drawNumber = (gameId: string, token: string) => request<DrawResult>(`/games/${gameId}/calls`, { method: 'POST', token })
export const setGameStatus = (gameId: string, token: string, status: 'paused' | 'playing' | 'finished') =>
  request<{ status: string }>(`/games/${gameId}/status`, { method: 'PATCH', token, body: { status } })
export const revealCalls = (gameId: string, token: string, seqs: number[]) =>
  request<{ ok: boolean; revealed_seqs: number[] }>(`/games/${gameId}/reveals`, { method: 'PUT', token, body: { seqs } })
export const updateGameBank = (gameId: string, token: string, bank: unknown) =>
  request<{ ok: boolean }>(`/games/${gameId}/bank`, { method: 'PUT', token, body: { bank } })

// Serialize rapid taps so saves cannot arrive out of order; claims await them.
const markQueues = new Map<string, Promise<unknown>>()
const markKey = (gameId: string, token: string) => `${gameId}:${token}`
export function setPlayerMarks(gameId: string, token: string, marked: number[]): Promise<{ ok: boolean; marked: number[] }> {
  const key = markKey(gameId, token)
  const previous = markQueues.get(key) ?? Promise.resolve()
  const pending = previous.catch(() => {}).then(() =>
    request<{ ok: boolean; marked: number[] }>(`/games/${gameId}/marks`, { method: 'PUT', token, body: { marked } }),
  )
  markQueues.set(key, pending)
  return pending
}
export async function submitClaim(gameId: string, token: string, claim: ClaimType): Promise<ClaimResult> {
  try {
    await markQueues.get(markKey(gameId, token))
    return await request<ClaimResult>(`/games/${gameId}/claims`, { method: 'POST', token, body: { claim } })
  } catch (error) {
    return { ok: true, accepted: false, status: 'rejected', reason: error instanceof Error ? error.message : 'Claim failed', points: 0 }
  }
}
