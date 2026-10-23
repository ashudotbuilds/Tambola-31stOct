import type { Database, SqlClient } from '../../db/database'
import { AppError, ensure } from '../../errors'
import type { AuthContext } from '../auth/models'
import { recordAudit } from '../auth/repository'

interface RoundForRecovery { id: string; event_id: string; status: string }

async function inspectRound(tx: SqlClient, roundId: string) {
  const issues: string[] = []
  const { rows: [round] } = await tx.query<RoundForRecovery>('SELECT id,event_id,status FROM rounds WHERE id=$1', [roundId])
  ensure(round, 404, 'Round not found')
  const [{ rows: draws }, { rows: participants }, { rows: tickets }, { rows: patterns }, { rows: claims }] = await Promise.all([
    tx.query<{ seq: number; key_id: string; question_id: string | null; question_snapshot: string; key_snapshot: string; revealed_at: Date | null }>('SELECT seq,key_id,question_id,question_snapshot,key_snapshot,revealed_at FROM round_draws WHERE round_id=$1 ORDER BY seq', [roundId]),
    tx.query<{ count: number }>('SELECT count(*)::int AS count FROM participant_profiles WHERE event_id=$1', [round.event_id]),
    tx.query<{ participant_profile_id: string; cells: unknown; marked_cell_ids: string[]; cut_cell_ids: string[] }>('SELECT participant_profile_id,cells,marked_cell_ids,cut_cell_ids FROM round_tickets WHERE round_id=$1', [roundId]),
    tx.query<{ pattern: string; points: number; winner_count: number; max_winners: number; enabled: boolean; status: string }>(
      `SELECT p.pattern,p.points,count(c.id) FILTER (WHERE c.status='VERIFIED')::int AS winner_count,
              p.max_winners,p.enabled,p.status FROM round_patterns p
       LEFT JOIN round_claims c ON c.round_id=p.round_id AND c.pattern=p.pattern
       WHERE p.round_id=$1 GROUP BY p.id`, [roundId],
    ),
    tx.query<{ pattern: string; status: string; points: number; reviewed_at: Date | null }>('SELECT pattern,status,points,reviewed_at FROM round_claims WHERE round_id=$1', [roundId]),
  ])
  if (draws.some((draw, index) => draw.seq !== index + 1) || draws.length > 90) issues.push('DRAW_SEQUENCE_INVALID')
  if (draws.some(draw => !draw.question_id || !draw.question_snapshot.trim() || !draw.key_snapshot.trim())) issues.push('DRAW_SNAPSHOT_MISSING')
  if (participants[0]?.count !== tickets.length) issues.push('PARTICIPANT_TICKETS_INCOMPLETE')
  const revealedKeys = new Set(draws.filter(draw => draw.revealed_at).map(draw => draw.key_id))
  const ticketByParticipant = new Map<string, Set<string>>()
  for (const ticket of tickets) {
    const cells = Array.isArray(ticket.cells) ? ticket.cells as unknown[] : []
    const values = cells.flatMap(row => Array.isArray(row) ? row.filter((value): value is string => typeof value === 'string') : [])
    if (cells.length !== 3 || cells.some(row => !Array.isArray(row) || row.length !== 9) || values.length !== 15 || new Set(values).size !== 15) {
      issues.push('TICKET_STRUCTURE_INVALID')
      continue
    }
    const ticketKeys = new Set(values)
    ticketByParticipant.set(ticket.participant_profile_id, ticketKeys)
    const marked = new Set(ticket.marked_cell_ids ?? [])
    const cut = new Set(ticket.cut_cell_ids ?? [])
    if ([...marked, ...cut].some(key => !ticketKeys.has(key)) || [...marked].some(key => cut.has(key))) issues.push('TICKET_MARK_STATE_INVALID')
    if ([...marked].some(key => !revealedKeys.has(key))) issues.push('MARK_WITHOUT_REVEALED_DRAW')
  }
  if (tickets.some(ticket => !ticketByParticipant.has(ticket.participant_profile_id))) issues.push('TICKET_STRUCTURE_INVALID')
  const patternByName = new Map(patterns.map(pattern => [pattern.pattern, pattern]))
  if (patterns.some(pattern => pattern.winner_count > pattern.max_winners || (pattern.status === 'OPEN' && pattern.winner_count >= pattern.max_winners) || (pattern.status === 'CLOSED' && pattern.winner_count < pattern.max_winners))) {
    issues.push('WINNER_CAPACITY_INCONSISTENT')
  }
  if (claims.some(claim => {
    const pattern = patternByName.get(claim.pattern)
    return !pattern || (claim.status === 'VERIFIED' && (!claim.reviewed_at || claim.points !== pattern.points)) ||
      (claim.status === 'PENDING_VERIFICATION' && !!claim.reviewed_at)
  })) issues.push('CLAIM_STATE_INCONSISTENT')
  const uniqueIssues = [...new Set(issues)]
  return { round, issues: uniqueIssues }
}

export async function recoverInterruptedRounds(db: Database) {
  return db.transaction(async tx => {
    const { rows: candidates } = await tx.query<{ id: string; event_id: string }>(
      `SELECT id,event_id FROM rounds WHERE status='ACTIVE' ORDER BY event_id,id`,
    )
    const recovered: string[] = []
    for (const candidate of candidates) {
      await tx.query('SELECT id FROM events WHERE id=$1 FOR UPDATE', [candidate.event_id])
      const { rows: [round] } = await tx.query<RoundForRecovery>("SELECT id,event_id,status FROM rounds WHERE id=$1 FOR UPDATE", [candidate.id])
      if (!round || round.status !== 'ACTIVE') continue
      const validation = await inspectRound(tx, round.id)
      await tx.query("UPDATE rounds SET status='RECOVERY_REQUIRED', updated_at=now() WHERE id=$1", [round.id])
      await tx.query("UPDATE events SET status='PAUSED', updated_at=now() WHERE id=$1 AND status='LIVE'", [round.event_id])
      await tx.query(
        `INSERT INTO round_recovery_records(round_id,validation_status,validation_issues)
         VALUES ($1,$2,$3::jsonb) ON CONFLICT(round_id) DO UPDATE SET
           detected_at=now(),validation_status=EXCLUDED.validation_status,
           validation_issues=EXCLUDED.validation_issues,last_validated_at=now(),resolved_at=NULL,resolved_by=NULL`,
        [round.id, validation.issues.length ? 'FAILED' : 'VALID', JSON.stringify(validation.issues)],
      )
      await recordAudit(tx, { action: 'ROUND_RECOVERY_REQUIRED', resourceType: 'round', resourceId: round.id, metadata: { validationStatus: validation.issues.length ? 'FAILED' : 'VALID', count: validation.issues.length } })
      recovered.push(round.id)
    }
    return recovered
  })
}

export class RecoveryService {
  constructor(readonly db: Database) {}

  async inspect(roundId: string) {
    return this.db.transaction(async tx => {
      const result = await inspectRound(tx, roundId)
      return { ok: true as const, roundId, status: result.round.status, valid: result.issues.length === 0, issues: result.issues }
    })
  }

  async recover(actor: AuthContext, roundId: string) {
    const result = await this.db.transaction(async tx => {
      const { rows: [preliminary] } = await tx.query<{ event_id: string }>('SELECT event_id FROM rounds WHERE id=$1', [roundId])
      ensure(preliminary, 404, 'Round not found')
      await tx.query('SELECT id FROM events WHERE id=$1 FOR UPDATE', [preliminary.event_id])
      const { rows: [round] } = await tx.query<RoundForRecovery>('SELECT id,event_id,status FROM rounds WHERE id=$1 FOR UPDATE', [roundId])
      ensure(round?.status === 'RECOVERY_REQUIRED', 409, 'Round does not require recovery')
      const validation = await inspectRound(tx, roundId)
      await tx.query(
        `UPDATE round_recovery_records SET validation_status=$2,validation_issues=$3::jsonb,last_validated_at=now()
         WHERE round_id=$1`, [roundId, validation.issues.length ? 'FAILED' : 'VALID', JSON.stringify(validation.issues)],
      )
      if (validation.issues.length) {
        await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_RECOVERY_VALIDATION_FAILED', resourceType: 'round', resourceId: roundId, metadata: { count: validation.issues.length } })
        return { issues: validation.issues }
      }
      await tx.query("UPDATE rounds SET status='PAUSED', updated_at=now() WHERE id=$1", [roundId])
      await tx.query("UPDATE events SET status='PAUSED', updated_at=now() WHERE id=$1", [round.event_id])
      await tx.query('UPDATE round_recovery_records SET resolved_at=now(),resolved_by=$2 WHERE round_id=$1', [roundId, actor.user.id])
      await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_RECOVERED', resourceType: 'round', resourceId: roundId, metadata: { validationStatus: 'VALID' } })
      return { issues: [] as string[] }
    })
    ensure(result.issues.length === 0, 409, `Round integrity checks failed: ${result.issues.join(', ')}`)
    return { ok: true as const, status: 'PAUSED' as const }
  }
}
