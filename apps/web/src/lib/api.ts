import { request } from './http'
import { sessions } from './sessions'
import { getActiveBank } from './technicalBank'
import type { ClaimResult, ClaimType, CreateGameResult, DrawResult, GameState, JoinGameResult } from './types'
export { sessions } from './sessions'

export async function createGame(hostName: string): Promise<CreateGameResult> {
  const result = await request<CreateGameResult>('/games', { method: 'POST', body: { hostName: hostName.trim(), bank: getActiveBank() } })
  sessions.saveHost({ game_id: result.game_id, code: result.code, player_id: result.player_id,
    display_name: result.display_name, player_token: result.player_token, host_token: result.host_token })
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
