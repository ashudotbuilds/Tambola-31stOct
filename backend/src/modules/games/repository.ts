import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { SqlClient } from '../../db/database'
import { ensure } from '../../errors'
import type { GameRecord, PlayerRecord, TicketRecord } from './models'

export const newToken = () => randomBytes(32).toString('hex')
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
export function gameCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('')
}

export async function findGame(db: SqlClient, id: string, lock = false): Promise<GameRecord> {
  const { rows } = await db.query<GameRecord>(`SELECT * FROM games WHERE id = $1 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [id])
  ensure(rows[0], 404, 'Game not found')
  return rows[0]
}

export function requireHost(game: GameRecord, token: string) {
  ensure(game.host_token_hash === tokenHash(token), 403, 'Only the host can do that')
}

export async function findPlayer(db: SqlClient, gameId: string, token: string): Promise<PlayerRecord> {
  const { rows } = await db.query<PlayerRecord>('SELECT * FROM game_players WHERE game_id = $1 AND token_hash = $2', [gameId, tokenHash(token)])
  ensure(rows[0], 401, 'You are not in this game')
  return rows[0]
}

export async function findTicket(db: SqlClient, playerId: string, lock = false): Promise<TicketRecord> {
  const { rows } = await db.query<TicketRecord>(`SELECT * FROM tickets WHERE player_id = $1${lock ? ' FOR UPDATE' : ''}`, [playerId])
  ensure(rows[0], 404, 'Ticket not found')
  return rows[0]
}
