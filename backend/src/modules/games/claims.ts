import { isClaimEligible, pointsFor } from '../../shared/claims'
import type { ClaimResult, ClaimType } from '../../shared/types'
import type { Database } from '../../db/database'
import { ensure } from '../../errors'
import { findGame, findPlayer, findTicket } from './repository'
import { recordAudit } from '../auth/repository'

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
        const { rows: [updated] } = await db.query<{ score: number; wrong_claims: number }>(
          'UPDATE game_players SET wrong_claims = wrong_claims + 1 WHERE id = $1 RETURNING score, wrong_claims', [player.id],
        )
        await db.query("INSERT INTO claims (game_id, player_id, claim_type, status, points, reason) VALUES ($1,$2,$3,'rejected',0,$4)", [gameId, player.id, claim, 'Incorrect claim: pattern is not complete with officially called items'])
        await recordAudit(db, { actorId: player.account_user_id, action: 'GAME_CLAIM_REJECTED', resourceType: 'game', resourceId: gameId, metadata: { pattern: claim, status: 'rejected', points: 0, warningCount: updated.wrong_claims, suspicious: updated.wrong_claims >= 3, reason: 'Pattern not complete with officially called items' } })
        return { ok: true, accepted: false, status: 'rejected', reason: 'Incorrect claim. Check your pattern and called items. The host has been notified. No points deducted or cells cut.', points: 0,
          penalty: 0, cut: null, score: updated.score, wrong_claims: updated.wrong_claims }
      }

      const points = pointsFor(claim, game.settings)
      await db.query("INSERT INTO claims (game_id, player_id, claim_type, status, points) VALUES ($1,$2,$3,'accepted',$4)", [gameId, player.id, claim, points])
      const { rows: [updated] } = await db.query<{ score: number }>('UPDATE game_players SET score = score + $2 WHERE id = $1 RETURNING score', [player.id, points])
      if (claim === 'full_house') {
        await db.query("UPDATE games SET status = 'closing', settings = jsonb_set(settings, '{closing_seq}', to_jsonb(next_seq - 1)) WHERE id = $1", [gameId])
      } else if (claim === 'second_full_house') {
        await db.query("UPDATE games SET status = 'finished', finished_at = now() WHERE id = $1", [gameId])
      }
      await recordAudit(db, { actorId: player.account_user_id, action: 'GAME_CLAIM_ACCEPTED', resourceType: 'game', resourceId: gameId, metadata: { pattern: claim, status: 'accepted', points, score: updated.score } })
      return { ok: true, accepted: true, status: 'accepted', reason: null, points, score: updated.score }
    })
  }
}
