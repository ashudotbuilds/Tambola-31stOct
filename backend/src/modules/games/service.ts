import { randomInt } from 'node:crypto'
import { DEFAULT_TECHNICAL_BANK, type TechnicalItem } from '../../shared/bank'
import { DEFAULT_POINTS, ticketNumbers } from '../../shared/claims'
import type { ClaimType, GameState, GameStatus, Settings } from '../../shared/types'
import type { Database } from '../../db/database'
import { ensure } from '../../errors'
import { findGame, findPlayer, findTicket, gameCode, newToken, requireHost, tokenHash } from './repository'
import type { GameRecord, PlayerRecord } from './models'
import { generateTicket } from './ticket'
import { recordAudit } from '../auth/repository'

export class GameService {
  constructor(readonly db: Database) {}

  async create(hostName: string, bank: TechnicalItem[] = DEFAULT_TECHNICAL_BANK, accountId?: string) {
    const hostToken = newToken()
    const playerToken = newToken()
    const settings: Settings = {
      points: DEFAULT_POINTS, wrong_claim_penalty: 0, close_after_calls: 10,
      max_players: 100, reveal_seconds: 3, pause_after_calls: 4,
      revealed_seqs: [], question_batch_start: 1, custom_bank: bank,
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
      if (accountId) await db.query('UPDATE games SET account_user_id=$2 WHERE id=$1', [game.id, accountId])
      const { rows: [host] } = await db.query<PlayerRecord>(
        'INSERT INTO game_players (game_id, token_hash, display_name, is_host) VALUES ($1,$2,$3,true) RETURNING *',
        [game.id, tokenHash(playerToken), hostName],
      )
      if (accountId) await db.query('UPDATE game_players SET account_user_id=$2 WHERE id=$1', [host.id, accountId])
      await recordAudit(db,{actorId:accountId,action:'GAME_CREATED',resourceType:'game',resourceId:game.id})
      return { ok: true as const, game_id: game.id, code: game.code, status: game.status, settings,
        player_id: host.id, display_name: host.display_name, player_token: playerToken, host_token: hostToken }
    })
  }

  async remove(gameId: string, accountId: string, superAdmin: boolean, code: string) {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      ensure(superAdmin || game.account_user_id === accountId, 403, 'Only the game administrator can delete this game')
      ensure(code === game.code, 400, 'Enter the game code to confirm deletion')
      await db.query("UPDATE games SET deleted_at = now(), status = 'finished', finished_at = coalesce(finished_at, now()) WHERE id = $1", [gameId])
      await recordAudit(db, { actorId: accountId, action: 'GAME_DELETED', resourceType: 'game', resourceId: gameId, metadata: { gameCode: game.code, status: game.status } })
      return { ok: true }
    })
  }

  async resumeAccount(gameId: string, accountId: string, superAdmin: boolean) {
    return this.db.transaction(async db => {
      const game = await findGame(db,gameId,true)
      ensure(superAdmin || game.account_user_id === accountId,403,'Only the game administrator can manage this game')
      const hostToken=newToken(),playerToken=newToken()
      await db.query('UPDATE games SET host_token_hash=$2 WHERE id=$1',[gameId,tokenHash(hostToken)])
      const {rows:[host]}=await db.query<PlayerRecord>('UPDATE game_players SET token_hash=$2 WHERE game_id=$1 AND is_host RETURNING *',[gameId,tokenHash(playerToken)])
      ensure(host,404,'Game host not found')
      await recordAudit(db,{actorId:accountId,action:'GAME_SESSION_RESTORED',resourceType:'game',resourceId:gameId})
      return {ok:true as const,game_id:game.id,code:game.code,status:game.status,settings:game.settings,player_id:host.id,display_name:host.display_name,player_token:playerToken,host_token:hostToken}
    })
  }

  async join(code: string, name: string, accountId?: string) {
    return this.db.transaction(async db => {
      const { rows: [game] } = await db.query<GameRecord>('SELECT * FROM games WHERE code = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [code])
      ensure(game, 404, 'No game found with that code')
      ensure(!game.deleted_at && game.status !== 'finished', 410, 'This game has been ended by the host')
      if (accountId) {
        const { rows: [existing] } = await db.query<PlayerRecord>('SELECT * FROM game_players WHERE game_id=$1 AND account_user_id=$2 AND NOT is_host', [game.id, accountId])
        if (existing) {
          const token = newToken()
          await db.query('UPDATE game_players SET token_hash=$2 WHERE id=$1', [existing.id, tokenHash(token)])
          return { ok: true as const, game_id: game.id, code: game.code, status: game.status, settings: game.settings, player_id: existing.id, display_name: existing.display_name, player_token: token }
        }
      }
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
      if (accountId) await db.query('UPDATE game_players SET account_user_id=$2 WHERE id=$1', [player.id, accountId])
      await db.query('INSERT INTO tickets (game_id, player_id, cells) VALUES ($1,$2,$3)', [game.id, player.id, JSON.stringify(generateTicket())])
      await recordAudit(db,{actorId:accountId,action:'GAME_JOINED',resourceType:'game',resourceId:game.id})
      return { ok: true as const, game_id: game.id, code: game.code, status: game.status, settings: game.settings,
        player_id: player.id, display_name: player.display_name, player_token: token, player_count: count + 1 }
    })
  }

  async stateByCode(code: string) {
    const { rows: [game] } = await this.db.query<{ id: string }>('SELECT id FROM games WHERE code = $1 AND deleted_at IS NULL', [code])
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

  async start(gameId: string, token: string, actorId?: string) {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      requireHost(game, token)
      ensure(game.status === 'lobby', 409, 'Game has already started')
      const { rows } = await db.query('SELECT id FROM game_players WHERE game_id = $1 AND NOT is_host LIMIT 1', [gameId])
      ensure(rows.length, 409, 'At least one player must join first')
      await db.query("UPDATE games SET status = 'playing', started_at = now() WHERE id = $1", [gameId])
      await recordAudit(db,{actorId:actorId ?? game.account_user_id,action:'GAME_STARTED',resourceType:'game',resourceId:gameId})
      return { ok: true, status: 'playing' }
    })
  }

  async status(gameId: string, token: string, next: 'paused' | 'playing' | 'finished', actorId?: string) {
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
      await recordAudit(db,{actorId:actorId ?? game.account_user_id,action:'GAME_STATUS_CHANGED',resourceType:'game',resourceId:gameId,metadata:{status}})
      return { ok: true, status }
    })
  }

  async draw(gameId: string, token: string, actorId?: string) {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      requireHost(game, token)
      ensure(['playing', 'closing'].includes(game.status), 409,
        game.status === 'lobby' ? 'Start the game first' : game.status === 'paused' ? 'Game is paused' : 'Game is over')
      const { rows } = await db.query<{ number: number; seq: number }>('SELECT number, seq FROM game_calls WHERE game_id = $1', [gameId])
      const called = new Set(rows.map(row => row.number))
      const remaining = Array.from({ length: 90 }, (_, i) => i + 1).filter(n => !called.has(n))
      ensure(remaining.length, 409, 'All 90 numbers have been called')
      const number = remaining[randomInt(remaining.length)]
      const bank = game.settings.custom_bank as TechnicalItem[] ?? DEFAULT_TECHNICAL_BANK
      const clue = bank.find(item => item.id === number)?.clue ?? DEFAULT_TECHNICAL_BANK[number - 1].clue
      const seq = game.next_seq
      const revealed = new Set(game.settings.revealed_seqs ?? [])
      // Keep revealed answers visible until the next draw starts a new batch.
      if (rows.every(row => revealed.has(row.seq))) {
        await db.query("UPDATE games SET settings = jsonb_set(settings, '{question_batch_start}', to_jsonb($2::int)) WHERE id = $1", [gameId, seq])
      }
      await db.query('INSERT INTO game_calls (game_id, seq, number, clue) VALUES ($1,$2,$3,$4)', [gameId, seq, number, clue])
      const closing = game.settings.closing_seq
      const finished = game.status === 'closing' && closing !== undefined && seq - closing >= (game.settings.close_after_calls ?? 10)
      const status = finished ? 'finished' : game.status
      await db.query("UPDATE games SET next_seq = next_seq + 1, settings = jsonb_set(settings, '{display_seq}', 'null'::jsonb), status = $2, finished_at = CASE WHEN $2 = 'finished' THEN now() ELSE finished_at END WHERE id = $1", [gameId, status])
      await recordAudit(db,{actorId:actorId ?? game.account_user_id,action:'GAME_DRAW',resourceType:'game',resourceId:gameId,metadata:{seq, number, question: clue}})
      return { ok: true as const, seq, number, clue, status, called_count: called.size + 1 }
    })
  }

  async display(gameId: string, token: string, seq: number | null, actorId?: string) {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      requireHost(game, token)
      if (seq !== null) {
        const { rows } = await db.query('SELECT seq FROM game_calls WHERE game_id = $1 AND seq = $2', [gameId, seq])
        ensure(rows.length, 400, 'Only an already-called question can be shown')
      }
      await db.query("UPDATE games SET settings = jsonb_set(settings, '{display_seq}', $2::jsonb) WHERE id = $1", [gameId, JSON.stringify(seq)])
      await recordAudit(db, { actorId: actorId ?? game.account_user_id, action: 'GAME_QUESTION_DISPLAYED', resourceType: 'game', resourceId: gameId, metadata: { seq } })
      return { ok: true, display_seq: seq }
    })
  }

  async reveal(gameId: string, token: string, seqs: number[], actorId?: string) {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      requireHost(game, token)
      ensure(seqs.every(seq => seq < game.next_seq), 400, 'Cannot reveal a call that does not exist')
      // Concurrent host tabs may send an older snapshot. A reveal is permanent:
      // merge under the game lock so one request cannot hide another's answers.
      const revealed = [...new Set([...(game.settings.revealed_seqs ?? []), ...seqs])].sort((a, b) => a - b)
      await db.query("UPDATE games SET settings = jsonb_set(settings, '{revealed_seqs}', $2::jsonb) WHERE id = $1", [gameId, JSON.stringify(revealed)])
      await recordAudit(db, { actorId: actorId ?? game.account_user_id, action: 'GAME_ANSWERS_REVEALED', resourceType: 'game', resourceId: gameId, metadata: { total: revealed.length } })
      return { ok: true, revealed_seqs: revealed }
    })
  }

  async bank(gameId: string, token: string, bank: TechnicalItem[], actorId?: string) {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      requireHost(game, token)
      await db.query("UPDATE games SET settings = jsonb_set(settings, '{custom_bank}', $2::jsonb) WHERE id = $1", [gameId, JSON.stringify(bank)])
      await recordAudit(db, { actorId: actorId ?? game.account_user_id, action: 'GAME_BANK_UPDATED', resourceType: 'game', resourceId: gameId, metadata: { total: bank.length } })
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
