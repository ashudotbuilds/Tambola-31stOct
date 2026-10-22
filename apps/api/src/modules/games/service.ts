import { randomInt } from 'node:crypto'
import { DEFAULT_TECHNICAL_BANK, type TechnicalItem } from '@tambola/shared/bank'
import { DEFAULT_POINTS, ticketNumbers } from '@tambola/shared/claims'
import type { ClaimType, GameState, GameStatus, Settings } from '@tambola/shared/types'
import type { Database } from '../../db/database'
import { ensure } from '../../errors'
import { findGame, findPlayer, findTicket, gameCode, newToken, requireHost, tokenHash } from './repository'
import type { GameRecord, PlayerRecord } from './models'
import { generateTicket } from './ticket'

export class GameService {
  constructor(readonly db: Database) {}

  async create(hostName: string, bank: TechnicalItem[] = DEFAULT_TECHNICAL_BANK) {
    const hostToken = newToken()
    const playerToken = newToken()
    const settings: Settings = {
      points: DEFAULT_POINTS, wrong_claim_penalty: 10, close_after_calls: 10,
      max_players: 100, reveal_seconds: 3, pause_after_calls: 4,
      revealed_seqs: [], custom_bank: bank,
    }
    return this.db.transaction(async db => {
      // ON CONFLICT avoids aborting the transaction in the rare code collision.
      let game: GameRecord | undefined
      for (let attempt = 0; attempt < 50 && !game; attempt++) {
        const { rows } = await db.query<GameRecord>(
          'INSERT INTO games (code, host_token_hash, settings) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING RETURNING *',
          [gameCode(), tokenHash(hostToken), JSON.stringify(settings)],
        )
        game = rows[0]
      }
      ensure(game, 503, 'Could not allocate a game code, please retry')
      const { rows: [host] } = await db.query<PlayerRecord>(
        'INSERT INTO game_players (game_id, token_hash, display_name, is_host) VALUES ($1,$2,$3,true) RETURNING *',
        [game.id, tokenHash(playerToken), hostName],
      )
      return { ok: true as const, game_id: game.id, code: game.code, status: game.status, settings,
        player_id: host.id, display_name: host.display_name, player_token: playerToken, host_token: hostToken }
    })
  }

  async join(code: string, name: string) {
    return this.db.transaction(async db => {
      const { rows: [game] } = await db.query<GameRecord>('SELECT * FROM games WHERE code = $1 FOR UPDATE', [code])
      ensure(game, 404, 'No game found with that code')
      ensure(game.status === 'lobby', 409, 'That game has already started')
      const { rows: [{ count }] } = await db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM game_players WHERE game_id = $1', [game.id],
      )
      ensure(count < (game.settings.max_players ?? 100), 409, 'This game is full')
      const duplicate = await db.query('SELECT id FROM game_players WHERE game_id = $1 AND lower(display_name) = lower($2)', [game.id, name])
      ensure(!duplicate.rows.length, 409, 'That name is already taken in this game')
      const token = newToken()
      const { rows: [player] } = await db.query<PlayerRecord>(
        'INSERT INTO game_players (game_id, token_hash, display_name) VALUES ($1,$2,$3) RETURNING *',
        [game.id, tokenHash(token), name],
      )
      await db.query('INSERT INTO tickets (game_id, player_id, cells) VALUES ($1,$2,$3)', [game.id, player.id, JSON.stringify(generateTicket())])
      return { ok: true as const, game_id: game.id, code: game.code, status: game.status, settings: game.settings,
        player_id: player.id, display_name: player.display_name, player_token: token, player_count: count + 1 }
    })
  }

  async stateByCode(code: string) {
    const { rows: [game] } = await this.db.query<{ id: string }>('SELECT id FROM games WHERE code = $1', [code])
    ensure(game, 404, 'No game found with that code')
    return this.state(game.id)
  }

  async state(gameId: string, token?: string): Promise<GameState> {
    return this.db.transaction(async db => {
      // A coherent snapshot of game, calls, claims, and private ticket.
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
      const game = await findGame(db, gameId)
      const { rows: players } = await db.query<GameState['players'][number]>(
        'SELECT id, display_name AS name, is_host, score, wrong_claims FROM game_players WHERE game_id = $1 ORDER BY score DESC, created_at, id', [gameId],
      )
      const { rows: calls } = await db.query<GameState['calls'][number]>('SELECT seq, number, clue, called_at FROM game_calls WHERE game_id = $1 ORDER BY seq', [gameId])
      const { rows: claims } = await db.query<GameState['claims'][number]>(
        `SELECT c.id, c.player_id, p.display_name AS name, c.claim_type, c.status, c.points, c.reason, c.created_at
         FROM claims c JOIN game_players p ON p.id = c.player_id WHERE c.game_id = $1 ORDER BY c.created_at, c.id`, [gameId],
      )
      let me: GameState['me'] = null
      if (token) {
        const player = await findPlayer(db, gameId, token)
        const { rows: [ticket] } = await db.query<{ cells: number[][]; marked: number[]; cut: number[] }>('SELECT cells, marked, cut FROM tickets WHERE player_id = $1', [player.id])
        me = { player_id: player.id, name: player.display_name, is_host: player.is_host,
          score: player.score, wrong_claims: player.wrong_claims, ticket: ticket?.cells ?? [], marked: ticket?.marked ?? [], cut: ticket?.cut ?? [] }
      }
      return { ok: true, game_id: game.id, code: game.code, status: game.status,
        settings: game.settings, created_at: new Date(game.created_at).toISOString(), players, calls, claims, me }
    })
  }

  async start(gameId: string, token: string) {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      requireHost(game, token)
      ensure(game.status === 'lobby', 409, 'Game has already started')
      const { rows } = await db.query('SELECT id FROM game_players WHERE game_id = $1 AND NOT is_host LIMIT 1', [gameId])
      ensure(rows.length, 409, 'At least one player must join first')
      await db.query("UPDATE games SET status = 'playing', started_at = now() WHERE id = $1", [gameId])
      return { ok: true, status: 'playing' }
    })
  }

  async status(gameId: string, token: string, next: 'paused' | 'playing' | 'finished') {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      requireHost(game, token)
      let status: GameStatus = next
      let pausedFrom = game.paused_from_status
      if (next === 'paused') {
        ensure(['playing', 'closing'].includes(game.status), 409, 'Game cannot be paused right now')
        pausedFrom = game.status
      } else if (next === 'playing') {
        ensure(game.status === 'paused', 409, 'Game is not paused')
        status = pausedFrom ?? 'playing'
        pausedFrom = null
      } else {
        ensure(!['lobby', 'finished'].includes(game.status), 409, 'Game is not in progress')
      }
      await db.query("UPDATE games SET status = $2, paused_from_status = $3, finished_at = CASE WHEN $2 = 'finished' THEN now() ELSE finished_at END WHERE id = $1", [gameId, status, pausedFrom])
      return { ok: true, status }
    })
  }

  async draw(gameId: string, token: string) {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      requireHost(game, token)
      ensure(['playing', 'closing'].includes(game.status), 409,
        game.status === 'lobby' ? 'Start the game first' : game.status === 'paused' ? 'Game is paused' : 'Game is over')
      const { rows } = await db.query<{ number: number }>('SELECT number FROM game_calls WHERE game_id = $1', [gameId])
      const called = new Set(rows.map(row => row.number))
      const remaining = Array.from({ length: 90 }, (_, i) => i + 1).filter(n => !called.has(n))
      ensure(remaining.length, 409, 'All 90 numbers have been called')
      const number = remaining[randomInt(remaining.length)]
      const bank = game.settings.custom_bank as TechnicalItem[] ?? DEFAULT_TECHNICAL_BANK
      const clue = bank.find(item => item.id === number)?.clue ?? DEFAULT_TECHNICAL_BANK[number - 1].clue
      const seq = game.next_seq
      await db.query('INSERT INTO game_calls (game_id, seq, number, clue) VALUES ($1,$2,$3,$4)', [gameId, seq, number, clue])
      const closing = game.settings.closing_seq
      const finished = game.status === 'closing' && closing !== undefined && seq - closing >= (game.settings.close_after_calls ?? 10)
      const status = finished ? 'finished' : game.status
      await db.query("UPDATE games SET next_seq = next_seq + 1, status = $2, finished_at = CASE WHEN $2 = 'finished' THEN now() ELSE finished_at END WHERE id = $1", [gameId, status])
      return { ok: true as const, seq, number, clue, status, called_count: called.size + 1 }
    })
  }

  async reveal(gameId: string, token: string, seqs: number[]) {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      requireHost(game, token)
      ensure(seqs.every(seq => seq < game.next_seq), 400, 'Cannot reveal a call that does not exist')
      const revealed = [...new Set(seqs)].sort((a, b) => a - b)
      await db.query("UPDATE games SET settings = jsonb_set(settings, '{revealed_seqs}', $2::jsonb) WHERE id = $1", [gameId, JSON.stringify(revealed)])
      return { ok: true, revealed_seqs: revealed }
    })
  }

  async bank(gameId: string, token: string, bank: TechnicalItem[]) {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      requireHost(game, token)
      await db.query("UPDATE games SET settings = jsonb_set(settings, '{custom_bank}', $2::jsonb) WHERE id = $1", [gameId, JSON.stringify(bank)])
      return { ok: true }
    })
  }

  async marks(gameId: string, token: string, marks: number[]) {
    return this.db.transaction(async db => {
      // Mark saves lock only this player's ticket. Claims lock game then ticket;
      // marks never acquire the game lock, so independent players can tap freely.
      await findGame(db, gameId)
      const player = await findPlayer(db, gameId, token)
      ensure(!player.is_host, 403, 'The host does not play')
      const ticket = await findTicket(db, player.id, true)
      const numbers = new Set(ticketNumbers(ticket.cells))
      const marked = [...new Set(marks)].filter(n => numbers.has(n) && !ticket.cut.includes(n))
      await db.query('UPDATE tickets SET marked = $2 WHERE id = $1', [ticket.id, marked])
      return { ok: true, marked }
    })
  }
}
