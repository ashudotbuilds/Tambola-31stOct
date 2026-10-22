import { randomInt } from 'node:crypto'
import { isClaimEligible, pointsFor } from '../../shared/claims'
import type { ClaimResult, ClaimType } from '../../shared/types'
import type { Database } from '../../db/database'
import { ensure } from '../../errors'
import { findGame, findPlayer, findTicket } from './repository'

export class ClaimService {
  constructor(private db: Database) {}

  async submit(gameId: string, token: string, claim: ClaimType): Promise<ClaimResult> {
    return this.db.transaction(async db => {
      const game = await findGame(db, gameId, true)
      ensure(['playing', 'closing'].includes(game.status), 409, 'The game is not in progress')
      const player = await findPlayer(db, gameId, token)
      ensure(!player.is_host, 403, 'The host does not play')
      const ticket = await findTicket(db, player.id, true)
      const { rows: won } = await db.query<{ player_id: string; claim_type: ClaimType }>(
        "SELECT player_id, claim_type FROM claims WHERE game_id = $1 AND status = 'accepted'", [gameId],
      )
      if (claim === 'second_full_house') ensure(won.some(c => c.claim_type === 'full_house'), 409, 'The first full house has not been claimed yet')
      const existing = won.find(c => c.claim_type === claim)
      // Losing the race is never a wrong-claim penalty.
      if (existing) return { ok: true, accepted: false, status: 'rejected', points: 0,
        reason: existing.player_id === player.id ? 'You already claimed that' : 'Already claimed by another player' }

      const { rows: calls } = await db.query<{ number: number }>('SELECT number FROM game_calls WHERE game_id = $1', [gameId])
      const called = new Set(calls.map(c => c.number))
      const effective = new Set(ticket.marked.filter(n => called.has(n)))
      if (!isClaimEligible(claim, ticket.cells, effective, new Set(ticket.cut))) {
        const penalty = game.settings.wrong_claim_penalty ?? 10
        const candidates = ticket.marked.filter(n => !ticket.cut.includes(n))
        const cut = candidates.length ? candidates[randomInt(candidates.length)] : null
        if (cut !== null) await db.query('UPDATE tickets SET cut = array_append(cut, $2), marked = array_remove(marked, $2) WHERE id = $1', [ticket.id, cut])
        const { rows: [updated] } = await db.query<{ score: number; wrong_claims: number }>(
          'UPDATE game_players SET score = greatest(0, score - $2), wrong_claims = wrong_claims + 1 WHERE id = $1 RETURNING score, wrong_claims', [player.id, penalty],
        )
        await db.query("INSERT INTO claims (game_id, player_id, claim_type, status, points, reason) VALUES ($1,$2,$3,'rejected',$4,$5)", [gameId, player.id, claim, -penalty, 'Not valid on your ticket'])
        return { ok: true, accepted: false, status: 'rejected', reason: 'Not valid on your ticket', points: -penalty,
          penalty, cut, score: updated.score, wrong_claims: updated.wrong_claims }
      }

      const points = pointsFor(claim, game.settings)
      await db.query("INSERT INTO claims (game_id, player_id, claim_type, status, points) VALUES ($1,$2,$3,'accepted',$4)", [gameId, player.id, claim, points])
      const { rows: [updated] } = await db.query<{ score: number }>('UPDATE game_players SET score = score + $2 WHERE id = $1 RETURNING score', [player.id, points])
      if (claim === 'full_house') {
        await db.query("UPDATE games SET status = 'closing', settings = jsonb_set(settings, '{closing_seq}', to_jsonb(next_seq - 1)) WHERE id = $1", [gameId])
      } else if (claim === 'second_full_house') {
        await db.query("UPDATE games SET status = 'finished', finished_at = now() WHERE id = $1", [gameId])
      }
      return { ok: true, accepted: true, status: 'accepted', reason: null, points, score: updated.score }
    })
  }
}
