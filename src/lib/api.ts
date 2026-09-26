'use client'

import { insforge } from './insforge'
import {
  type ClaimResult,
  type ClaimType,
  type CreateGameResult,
  type DrawResult,
  type GameState,
  type HostSession,
  type JoinGameResult,
  type PlayerSession,
  type RpcFailure,
  isFailure,
} from './types'

const HOST_KEY = 'tt.host'
const PLAYER_KEY = 'tt.player'

/**
 * Call one of the game's SQL functions.
 *
 * PostgREST returns a jsonb result, so every reply is a single object shaped
 * either `{ ok: true, ... }` or `{ ok: false, error }`.
 */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | RpcFailure> {
  const { data, error } = await insforge.database.rpc(fn, args)
  if (error) throw new Error(error.message || `RPC ${fn} failed`)
  // Some shapes come back wrapped in a single-row array.
  const value = Array.isArray(data) && data.length === 1 ? data[0] : data
  if (value === null || value === undefined) throw new Error(`RPC ${fn} returned nothing`)
  return value as T
}

/** Turn an `{ ok: false, error }` reply into a thrown Error. */
function requireOk<T>(value: T | RpcFailure): T {
  if (isFailure(value)) throw new Error(value.error)
  return value as T
}

function read<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function clear(key: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(key)
}

// ------------------------------------------------------------------ sessions

export const sessions = {
  loadHost: (): HostSession | null => read<HostSession>(HOST_KEY),
  loadPlayer: (): PlayerSession | null => read<PlayerSession>(PLAYER_KEY),
  saveHost: (s: HostSession) => write(HOST_KEY, s),
  savePlayer: (s: PlayerSession) => write(PLAYER_KEY, s),
  clearHost: () => clear(HOST_KEY),
  clearPlayer: () => clear(PLAYER_KEY),
}

// ------------------------------------------------------------------ actions

export async function createGame(hostName: string): Promise<CreateGameResult> {
  const result = requireOk(await rpc<CreateGameResult>('create_game', {
    p_host_name: hostName.trim(),
  }))
  sessions.saveHost({
    game_id: result.game_id,
    code: result.code,
    player_id: result.player_id,
    display_name: result.display_name,
    player_token: result.player_token,
    host_token: result.host_token,
  })
  return result
}

export async function joinGame(code: string, name: string): Promise<JoinGameResult> {
  const result = requireOk(await rpc<JoinGameResult>('join_game', {
    p_code: code.trim().toUpperCase(),
    p_name: name.trim(),
  }))
  sessions.savePlayer({
    game_id: result.game_id,
    code: result.code,
    player_id: result.player_id,
    display_name: result.display_name,
    player_token: result.player_token,
  })
  return result
}

export async function getGameState(gameId: string, token?: string | null): Promise<GameState> {
  return requireOk(
    await rpc<GameState>('get_game_state', {
      p_game_id: gameId,
      p_player_token: token ?? null,
    }),
  )
}

export async function getGameStateByCode(code: string): Promise<GameState> {
  return requireOk(
    await rpc<GameState>('get_game_state_by_code', {
      p_code: code.trim().toUpperCase(),
    }),
  )
}

export async function startGame(gameId: string, hostToken: string): Promise<{ status: string }> {
  return requireOk(
    await rpc<{ ok: true; status: string }>('start_game', {
      p_game_id: gameId,
      p_host_token: hostToken,
    }),
  )
}

export async function drawNumber(gameId: string, hostToken: string): Promise<DrawResult> {
  return requireOk(
    await rpc<DrawResult>('draw_number', {
      p_game_id: gameId,
      p_host_token: hostToken,
    }),
  )
}

export async function setGameStatus(
  gameId: string,
  hostToken: string,
  status: 'paused' | 'playing' | 'finished',
): Promise<{ status: string }> {
  return requireOk(
    await rpc<{ ok: true; status: string }>('set_game_status', {
      p_game_id: gameId,
      p_host_token: hostToken,
      p_status: status,
    }),
  )
}

/**
 * Ask the server to judge a claim.
 *
 * A rejection is a legitimate outcome (wrong claim, or lost the race), so it is
 * returned rather than thrown. The server response is authoritative.
 */
export async function submitClaim(
  gameId: string,
  playerToken: string,
  claim: ClaimType,
): Promise<ClaimResult> {
  try {
    return requireOk(
      await rpc<ClaimResult>('submit_claim', {
        p_game_id: gameId,
        p_player_token: playerToken,
        p_claim: claim,
      }),
    )
  } catch (error) {
    return {
      ok: true,
      accepted: false,
      status: 'rejected',
      reason: error instanceof Error ? error.message : 'Claim failed',
      points: 0,
    }
  }
}
