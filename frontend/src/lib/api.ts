import { request } from './http'
import { sessions } from './sessions'
import { getActiveBank } from './technicalBank'
import { identifyTelemetry, resetTelemetry } from './telemetry'
import type {
  AuthMeResult,
  AuthUser,
  ClaimResult,
  ClaimType,
  CreateGameResult,
  DrawResult,
  GameState,
  GameUpdate,
  JoinGameResult,
  LoginResult,
} from './types'
export { sessions } from './sessions'

export async function loginUser(email: string, password: string): Promise<LoginResult> {
  const result = await request<LoginResult>('/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  identifyTelemetry(result.user, result.principal.type)
  return result
}

export async function logoutUser(token?: string): Promise<{ ok: boolean }> {
  const result = await request<{ ok: boolean }>('/v1/auth/logout', {
    method: 'POST',
    token,
  })
  resetTelemetry()
  return result
}

export async function getCurrentUser(token?: string): Promise<AuthMeResult> {
  const result = await request<AuthMeResult>('/v1/auth/me', {
    method: 'GET',
    token,
  })
  identifyTelemetry(result.user, result.principal.type)
  return result
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

export interface Participant {
  profile_id: string
  name: string
  email: string
  account_status: 'ACTIVE'|'INACTIVE'|'SUSPENDED'
  external_id: string | null
  credential_status: 'NOT_ISSUED'|'PENDING'|'SENT'|'FAILED'
  last_sent_at: string | null
  attempts: number | null
}
export async function listParticipants(): Promise<{ ok: true; participants: Participant[] }> {
  return request('/v1/admin/participants')
}
export async function issueParticipantCredential(profileId: string): Promise<{ ok: true; credential_status: string; email: string }> {
  return request(`/v1/admin/participants/${encodeURIComponent(profileId)}/credentials`, { method: 'POST', body: {} })
}

export interface ParticipantImportResult {
  ok: true
  created: number
  skipped: number
  failed: number
  rows: Array<{ row: number; status: 'created' | 'skipped' | 'failed'; message?: string }>
}

export async function importParticipants(csv: string): Promise<ParticipantImportResult> {
  return request('/v1/admin/participants/import', { method: 'POST', body: csv, bodyFormat: 'text', headers: { 'Content-Type': 'text/csv' } })
}

export interface AdminDashboard {
  ok: true
  counts: { participants: number; games: number; activeGames: number; draws: number; acceptedClaims: number; rejectedClaims: number }
  socketConnections: number
}
export async function getAdminDashboard(): Promise<AdminDashboard> { return request('/v1/admin/dashboard') }
export interface AuditEntry {
  id: string; actorId: string | null; actorName: string | null; actorEmail: string | null
  targetName: string | null; targetEmail: string | null; gameCode: string | null
  action: string; resourceType: string; resourceId: string | null; metadata: Record<string, unknown>
  createdAt: string; ipAddress: string | null; userAgent: string | null; suspicious: boolean
}
export interface AuditFilters { cursor?: string; limit?: number; search?: string; gameId?: string; suspicious?: boolean; action?: string; from?: string; to?: string }
export interface AuditResult { ok: true; entries: AuditEntry[]; nextCursor: string | null; game: { code: string; host: string | null; status: string; deleted: boolean } | null }
export async function listAudit(input: AuditFilters = {}): Promise<AuditResult> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') query.set(key, String(value))
  return request(`/v1/admin/audit${query.size ? `?${query}` : ''}`)
}
export const deleteAccountGame = (gameId: string, code: string) => request<{ ok: true }>(`/games/${encodeURIComponent(gameId)}`, { method: 'DELETE', body: { code } })
export async function getSystemDiagnostics(): Promise<{ ok: true; version: string | null; nodeVersion: string; readiness: boolean | null; latestMigration: string | null }> {
  return request('/v1/super-admin/system')
}
export async function createGame(hostName: string): Promise<CreateGameResult> {
  const result = await request<CreateGameResult>('/games', { method: 'POST', body: { hostName: hostName.trim(), bank: getActiveBank() } })
  sessions.saveHost({ game_id: result.game_id, code: result.code, player_id: result.player_id,
    display_name: result.display_name, player_token: result.player_token, host_token: result.host_token })
  return result
}
export async function listAccountGames() {
  return request<{ok:true;games:Array<{id:string;code:string;status:string;created_at:string;host_name:string;can_manage:boolean}>}>('/games')
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
export const getGameUpdates = (gameId: string, after: number, token?: string | null) => request<GameUpdate>(`/games/${gameId}/updates?after=${after}`, { token })
export const getGameStateByCode = (code: string) => request<GameState>(`/games/code/${encodeURIComponent(code.trim().toUpperCase())}`)
export const startGame = (gameId: string, token: string) => request<{ status: string }>(`/games/${gameId}/start`, { method: 'POST', token })
export const drawNumber = (gameId: string, token: string) => request<DrawResult>(`/games/${gameId}/calls`, { method: 'POST', token })
export const setGameStatus = (gameId: string, token: string, status: 'paused' | 'playing' | 'finished') =>
  request<{ status: string }>(`/games/${gameId}/status`, { method: 'PATCH', token, body: { status } })
export const displayQuestion = (gameId: string, token: string, seq: number | null) =>
  request<{ ok: boolean; display_seq: number | null }>(`/games/${gameId}/display`, { method: 'PUT', token, body: { seq } })
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
