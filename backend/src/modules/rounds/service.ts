import { randomInt } from 'node:crypto'
import type { Database, SqlClient } from '../../db/database'
import { AppError, ensure } from '../../errors'
import type { AuthContext } from '../auth/models'
import { recordAudit } from '../auth/repository'
import { runIdempotently } from '../idempotency/service'
import { generateRoundTicket } from './ticket'
import { DEFAULT_POINTS } from '../../shared/claims'

const PATTERNS = ['early_five','four_corners','top_line','middle_line','bottom_line','full_house','second_full_house'] as const
type Pattern = typeof PATTERNS[number]
type TicketCells = (string | null)[][]
interface RoundRow { id: string; event_id: string; round_no: number; name: string; status: string; closing_seq: number | null; close_after_calls: number; wrong_claim_penalty: number; created_at: Date; updated_at: Date }
interface EventRow { id: string; name: string; status: string }

function normalizeKey(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US')
}

async function getRound(db: SqlClient, roundId: string, lock = false) {
  const { rows } = await db.query<RoundRow>(`SELECT * FROM rounds WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [roundId])
  ensure(rows[0], 404, 'Round not found')
  return rows[0]
}

async function validateReady(tx: SqlClient, eventId: string, roundId: string) {
  const [{ rows: questionRows }, { rows: patternRows }, { rows: participantRows }, { rows: ticketRows }] = await Promise.all([
    tx.query<{ count: number }>(`SELECT count(DISTINCT q.key_id)::int AS count FROM round_questions q JOIN event_keys k ON k.id=q.key_id WHERE q.round_id=$1 AND q.active AND k.active`, [roundId]),
    tx.query<{ count: number }>('SELECT count(*)::int AS count FROM round_patterns WHERE round_id=$1 AND enabled', [roundId]),
    tx.query<{ count: number }>('SELECT count(*)::int AS count FROM participant_profiles WHERE event_id=$1', [eventId]),
    tx.query<{ count: number }>('SELECT count(*)::int AS count FROM round_tickets WHERE round_id=$1', [roundId]),
  ])
  ensure((questionRows[0]?.count ?? 0) >= 15, 409, 'Round needs at least 15 distinct active question/key pairs')
  ensure((patternRows[0]?.count ?? 0) > 0, 409, 'Enable at least one claim pattern')
  ensure((participantRows[0]?.count ?? 0) > 0 && participantRows[0].count === ticketRows[0]?.count, 409, 'Generate a ticket for every event participant')
}

function ticketValues(cells: TicketCells) { return cells.flat().filter((value): value is string => value !== null) }

function isClaimEligible(pattern: Pattern, cells: TicketCells, markedCellIds: string[]) {
  const marked = new Set(markedCellIds)
  const nonBlank = ticketValues(cells)
  const rowKeys = cells.map(row => row.filter((id): id is string => id !== null))
  if (pattern === 'early_five') return nonBlank.filter(id => marked.has(id)).length >= 5
  if (pattern === 'four_corners') return [[0,0],[0,8],[2,0],[2,8]].every(([r,c]) => !!cells[r]?.[c] && marked.has(cells[r][c]!))
  if (pattern === 'top_line') return rowKeys[0].every(id => marked.has(id))
  if (pattern === 'middle_line') return rowKeys[1].every(id => marked.has(id))
  if (pattern === 'bottom_line') return rowKeys[2].every(id => marked.has(id))
  return nonBlank.length > 0 && nonBlank.every(id => marked.has(id))
}

async function completeRound(tx: SqlClient, roundId: string, eventId: string) {
  await tx.query("UPDATE rounds SET status='COMPLETED',completed_at=now(),updated_at=now() WHERE id=$1", [roundId])
  const { rows: remaining } = await tx.query("SELECT id FROM rounds WHERE event_id=$1 AND id<>$2 AND status IN ('DRAFT','READY') LIMIT 1", [eventId, roundId])
  await tx.query('UPDATE events SET status=$2,updated_at=now() WHERE id=$1', [eventId, remaining.length ? 'READY' : 'COMPLETED'])
}

async function publicSnapshot(db: SqlClient, roundId: string, includePending: boolean) {
  const { rows: [event] } = await db.query<{ id: string; name: string; status: string }>(
    `SELECT e.id, e.name, e.status FROM events e JOIN rounds r ON r.event_id=e.id WHERE r.id=$1`, [roundId],
  )
  ensure(event, 404, 'Round not found')
  const round = await getRound(db, roundId)
  const { rows: draws } = await db.query(
    `SELECT seq, manual, drawn_at, revealed_at,
            CASE WHEN revealed_at IS NULL THEN NULL ELSE question_snapshot END AS question,
            CASE WHEN revealed_at IS NULL THEN NULL ELSE key_snapshot END AS key
     FROM round_draws WHERE round_id=$1 ORDER BY seq`, [roundId],
  )
  const { rows: winners } = await db.query(
    `SELECT c.pattern, c.points, u.name, c.reviewed_at AS verified_at
     FROM round_claims c JOIN participant_profiles pp ON pp.id=c.participant_profile_id
     JOIN users u ON u.id=pp.user_id
     WHERE c.round_id=$1 AND c.status='VERIFIED' ORDER BY c.reviewed_at, c.id`, [roundId],
  )
  const { rows: claimCounts } = await db.query(
    `SELECT status, count(*)::int AS count FROM round_claims WHERE round_id=$1 GROUP BY status`, [roundId],
  )
  const { rows: standings } = await db.query(
    `SELECT u.name, s.score, s.wrong_claims FROM round_player_scores s
     JOIN participant_profiles pp ON pp.id=s.participant_profile_id JOIN users u ON u.id=pp.user_id
     WHERE s.round_id=$1 ORDER BY s.score DESC,s.wrong_claims ASC,lower(u.name),pp.id`, [roundId],
  )
  return {
    ok: true as const,
    event: { id: event.id, name: event.name, status: event.status },
    round: { id: round.id, number: round.round_no, name: round.name, status: round.status, closing_seq: round.closing_seq, close_after_calls: round.close_after_calls },
    draws,
    winners,
    standings,
    ...(includePending ? { claims: claimCounts } : {}),
  }
}

export class RoundService {
  constructor(readonly db: Database) {}

  async list(actor: AuthContext, eventId: string) {
    const { rows: events } = await this.db.query<EventRow>('SELECT id, name, status FROM events WHERE id = $1', [eventId])
    ensure(events[0], 404, 'Event not found')
    const { rows } = await this.db.query<RoundRow>(
      `SELECT * FROM rounds WHERE event_id = $1 ORDER BY round_no`, [eventId],
    )
    const summaries = await Promise.all(rows.map(async round => {
      const [{ rows: questionRows }, { rows: patternRows }, { rows: ticketRows }] = await Promise.all([
        this.db.query<{ count: number }>('SELECT count(*)::int AS count FROM round_questions WHERE round_id = $1 AND active', [round.id]),
        this.db.query<{ pattern: string; enabled: boolean; max_winners: number; status: string }>('SELECT pattern, enabled, max_winners, status FROM round_patterns WHERE round_id = $1 ORDER BY pattern', [round.id]),
        this.db.query<{ count: number }>('SELECT count(*)::int AS count FROM round_tickets WHERE round_id = $1', [round.id]),
      ])
      return { ...round, question_count: questionRows[0]?.count ?? 0, patterns: patternRows, ticket_count: ticketRows[0]?.count ?? 0 }
    }))
    return { ok: true as const, event: events[0], rounds: summaries }
  }

  async create(actor: AuthContext, eventId: string, name: string) {
    return this.db.transaction(async tx => {
      const { rows: [event] } = await tx.query<EventRow>('SELECT id, name, status FROM events WHERE id = $1 FOR UPDATE', [eventId])
      ensure(event, 404, 'Event not found')
      ensure(['DRAFT','READY'].includes(event.status), 409, 'Rounds cannot be added after the event starts')
      const { rows: [last] } = await tx.query<{ round_no: number | null }>('SELECT max(round_no)::int AS round_no FROM rounds WHERE event_id = $1', [eventId])
      const roundNo = (last?.round_no ?? 0) + 1
      const { rows: [round] } = await tx.query<RoundRow>(
        `INSERT INTO rounds(event_id, round_no, name) VALUES ($1,$2,$3) RETURNING *`, [eventId, roundNo, name],
      )
      for (const pattern of PATTERNS) {
        await tx.query('INSERT INTO round_patterns(round_id, pattern, points) VALUES ($1,$2,$3)', [round.id, pattern, DEFAULT_POINTS[pattern]])
      }
      await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_CREATED', resourceType: 'round', resourceId: round.id, metadata: { eventId, roundNo } })
      return { ok: true as const, round }
    })
  }

  async addKey(actor: AuthContext, eventId: string, value: string) {
    const normalized = normalizeKey(value)
    ensure(normalized.length >= 2 && normalized.length <= 50, 400, 'Key must contain 2 to 50 characters after normalization')
    return this.db.transaction(async tx => {
      const { rows: [event] } = await tx.query<EventRow>('SELECT id, name, status FROM events WHERE id = $1 FOR UPDATE', [eventId])
      ensure(event, 404, 'Event not found')
      ensure(['DRAFT','READY'].includes(event.status), 409, 'Keys cannot be added after the event starts')
      const { rows: [key] } = await tx.query<{ id: string; value: string; event_id: string }>(
        `INSERT INTO event_keys(event_id, value, normalized_value) VALUES ($1,$2,$3)
         RETURNING id, value, event_id`, [eventId, value.trim().replace(/\s+/g, ' '), normalized],
      )
      await recordAudit(tx, { actorId: actor.user.id, action: 'EVENT_KEY_CREATED', resourceType: 'event_key', resourceId: key.id, metadata: { eventId, value: key.value } })
      return { ok: true as const, key }
    }).catch(error => {
      if ((error as { code?: string }).code === '23505') throw new AppError(409, 'A key with that normalized value already exists for this event')
      throw error
    })
  }

  async listKeys(eventId: string) {
    const { rows } = await this.db.query('SELECT id, value, active, created_at FROM event_keys WHERE event_id = $1 ORDER BY normalized_value', [eventId])
    return { ok: true as const, keys: rows }
  }

  async addQuestion(actor: AuthContext, roundId: string, keyId: string, question: string) {
    return this.db.transaction(async tx => {
      const round = await getRound(tx, roundId, true)
      ensure(['DRAFT','READY'].includes(round.status), 409, 'Round content is locked after the round starts')
      const { rows: [key] } = await tx.query<{ id: string }>('SELECT id FROM event_keys WHERE id = $1 AND event_id = $2 AND active', [keyId, round.event_id])
      ensure(key, 404, 'Active key not found for this event')
      const { rows: [item] } = await tx.query(
        `INSERT INTO round_questions(event_id, round_id, key_id, question) VALUES ($1,$2,$3,$4)
         RETURNING id, round_id, key_id, question, active`, [round.event_id, roundId, keyId, question],
      )
      await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_QUESTION_CREATED', resourceType: 'round_question', resourceId: (item as { id: string }).id, metadata: { roundId, keyId } })
      return { ok: true as const, question: item }
    }).catch(error => {
      if ((error as { code?: string }).code === '23505') throw new AppError(409, 'This round already has a question for that key')
      throw error
    })
  }

  async listQuestions(roundId: string) {
    const round = await getRound(this.db, roundId)
    const { rows } = await this.db.query(
      `SELECT q.id, q.key_id, k.value AS key, q.question, q.active
       FROM round_questions q JOIN event_keys k ON k.id = q.key_id
       WHERE q.round_id = $1 ORDER BY k.normalized_value`, [roundId],
    )
    return { ok: true as const, round_id: round.id, questions: rows }
  }

  async setPattern(actor: AuthContext, roundId: string, pattern: Pattern, input: { enabled: boolean; maxWinners: number }) {
    return this.db.transaction(async tx => {
      const round = await getRound(tx, roundId, true)
      ensure(['DRAFT','READY'].includes(round.status), 409, 'Patterns are locked after the round starts')
      const { rows: [updated] } = await tx.query(
        `UPDATE round_patterns SET enabled = $3, max_winners = $4
         WHERE round_id = $1 AND pattern = $2 RETURNING pattern, enabled, max_winners, status`,
        [roundId, pattern, input.enabled, input.maxWinners],
      )
      ensure(updated, 404, 'Pattern not found')
      await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_PATTERN_UPDATED', resourceType: 'round_pattern', resourceId: roundId, metadata: { pattern, ...input } })
      return { ok: true as const, pattern: updated }
    })
  }

  async generateTickets(actor: AuthContext, roundId: string, idempotencyKey: string) {
    return runIdempotently({ db: this.db, actorId: actor.user.id, operation: 'round.tickets.generate', key: idempotencyKey, payload: { roundId }, work: async tx => {
      const round = await getRound(tx, roundId, true)
      ensure(['DRAFT','READY'].includes(round.status), 409, 'Tickets are immutable after the round starts')
      const { rows: keys } = await tx.query<{ id: string }>(
        `SELECT DISTINCT k.id FROM round_questions q JOIN event_keys k ON k.id = q.key_id
         WHERE q.round_id = $1 AND q.active AND k.active ORDER BY k.id`, [roundId],
      )
      ensure(keys.length >= 15, 409, 'At least 15 distinct active question keys are required')
      const { rows: participants } = await tx.query<{ id: string }>('SELECT id FROM participant_profiles WHERE event_id = $1 ORDER BY id', [round.event_id])
      ensure(participants.length > 0, 409, 'Import at least one participant before generating tickets')
      const { rows: existing } = await tx.query<{ participant_profile_id: string }>('SELECT participant_profile_id FROM round_tickets WHERE round_id = $1', [roundId])
      const assigned = new Set(existing.map(row => row.participant_profile_id))
      let created = 0
      for (const participant of participants) {
        await tx.query('INSERT INTO round_player_scores(round_id,event_id,participant_profile_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [roundId, round.event_id, participant.id])
        if (assigned.has(participant.id)) continue
        const numericKeys = keys.map(key => key.id)
        const ticket = generateRoundTicket(numericKeys)
        await tx.query(
          `INSERT INTO round_tickets(event_id, round_id, participant_profile_id, cells)
           VALUES ($1,$2,$3,$4::jsonb)`, [round.event_id, roundId, participant.id, JSON.stringify(ticket)],
        )
        created++
      }
      await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_TICKETS_GENERATED', resourceType: 'round', resourceId: roundId, metadata: { created, total: participants.length } })
      return { ok: true as const, created, total: participants.length }
    } })
  }

  async changeStatus(actor: AuthContext, roundId: string, action: 'ready'|'start'|'pause'|'resume'|'complete'|'cancel', idempotencyKey: string) {
    return runIdempotently({ db: this.db, actorId: actor.user.id, operation: `round.lifecycle.${action}`, key: idempotencyKey, payload: { roundId, action }, work: async tx => {
      const { rows: preliminary } = await tx.query<RoundRow>('SELECT * FROM rounds WHERE id = $1', [roundId])
      ensure(preliminary[0], 404, 'Round not found')
      const eventId = preliminary[0].event_id
      const { rows: [event] } = await tx.query<EventRow>('SELECT id, name, status FROM events WHERE id = $1 FOR UPDATE', [eventId])
      ensure(event, 404, 'Event not found')
      const round = await getRound(tx, roundId, true)

      if (action === 'ready') {
        ensure(round.status === 'DRAFT', 409, 'Only a draft round can become ready')
        await validateReady(tx, eventId, roundId)
        await tx.query("UPDATE rounds SET status='READY', updated_at=now() WHERE id=$1", [roundId])
        if (event.status === 'DRAFT') await tx.query("UPDATE events SET status='READY', updated_at=now() WHERE id=$1", [eventId])
      } else if (action === 'start') {
        ensure(round.status === 'READY', 409, 'Only a ready round can start')
        ensure(['DRAFT','READY'].includes(event.status), 409, 'Event cannot start in its current state')
        await validateReady(tx, eventId, roundId)
        await tx.query("UPDATE events SET status='LIVE', updated_at=now() WHERE id=$1", [eventId])
        await tx.query("UPDATE rounds SET status='ACTIVE', started_at=now(), updated_at=now() WHERE id=$1", [roundId])
      } else if (action === 'pause') {
        ensure(round.status === 'ACTIVE' && event.status === 'LIVE', 409, 'Only an active round can be paused')
        await tx.query("UPDATE rounds SET status='PAUSED', updated_at=now() WHERE id=$1", [roundId])
        await tx.query("UPDATE events SET status='PAUSED', updated_at=now() WHERE id=$1", [eventId])
      } else if (action === 'resume') {
        ensure(round.status === 'PAUSED' && event.status === 'PAUSED', 409, 'Only a paused round can resume')
        await tx.query("UPDATE rounds SET status='ACTIVE', updated_at=now() WHERE id=$1", [roundId])
        await tx.query("UPDATE events SET status='LIVE', updated_at=now() WHERE id=$1", [eventId])
      } else if (action === 'complete') {
        ensure(['ACTIVE','PAUSED'].includes(round.status), 409, 'Only an active or paused round can complete')
        await tx.query("UPDATE rounds SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1", [roundId])
        const { rows: remaining } = await tx.query('SELECT id FROM rounds WHERE event_id=$1 AND id<>$2 AND status IN (\'DRAFT\',\'READY\') LIMIT 1', [eventId, roundId])
        await tx.query('UPDATE events SET status=$2, updated_at=now() WHERE id=$1', [eventId, remaining.length ? 'READY' : 'COMPLETED'])
      } else {
        ensure(['DRAFT','READY'].includes(round.status), 409, 'Started rounds cannot be cancelled')
        await tx.query("UPDATE rounds SET status='CANCELLED', updated_at=now() WHERE id=$1", [roundId])
      }

      await recordAudit(tx, { actorId: actor.user.id, action: `ROUND_${action.toUpperCase()}`, resourceType: 'round', resourceId: roundId, metadata: { eventId } })
      return { ok: true as const, status: action === 'ready' ? 'READY' : action === 'start' || action === 'resume' ? 'ACTIVE' : action === 'pause' ? 'PAUSED' : action === 'complete' ? 'COMPLETED' : 'CANCELLED' }
    } })
  }

  async myTicket(actor: AuthContext, roundId: string) {
    ensure(actor.principal.type === 'PARTICIPANT' && actor.principal.eventId, 403, 'Participant access is required')
    const round = await getRound(this.db, roundId)
    ensure(round.event_id === actor.principal.eventId, 404, 'Round not found for this participant')
    const { rows: [ticket] } = await this.db.query<{ cells: TicketCells; marked_cell_ids: string[]; cut_cell_ids: string[] }>(
      `SELECT cells, marked_cell_ids, cut_cell_ids FROM round_tickets WHERE round_id=$1 AND participant_profile_id=$2`,
      [roundId, actor.principal.profileId],
    )
    ensure(ticket, 404, 'Ticket has not been assigned yet')
    const keyIds = [...new Set(ticket.cells.flat().filter((id): id is string => typeof id === 'string'))]
    const { rows: keys } = await this.db.query<{ id: string; value: string }>('SELECT id, value FROM event_keys WHERE id = ANY($1::uuid[])', [keyIds])
    const values = new Map(keys.map(key => [key.id, key.value]))
    const snapshot = await publicSnapshot(this.db, roundId, false)
    const { rows: claims } = await this.db.query(
      'SELECT pattern, status, submitted_at, reviewed_at, reason, points, penalty, cut_cell_id FROM round_claims WHERE round_id=$1 AND participant_profile_id=$2 ORDER BY submitted_at DESC',
      [roundId, actor.principal.profileId],
    )
    const { rows: patterns } = await this.db.query('SELECT pattern, enabled, max_winners, status FROM round_patterns WHERE round_id=$1 ORDER BY pattern', [roundId])
    const { rows: [score] } = await this.db.query('SELECT score,wrong_claims FROM round_player_scores WHERE round_id=$1 AND participant_profile_id=$2', [roundId, actor.principal.profileId])
    return { ...snapshot, ticket: { cells: ticket.cells.map(row => row.map(id => id ? { id, value: values.get(id) ?? '' } : null)), marked_cell_ids: ticket.marked_cell_ids, cut_cell_ids: ticket.cut_cell_ids }, claims, patterns, score: score ?? { score: 0, wrong_claims: 0 } }
  }

  async myRounds(actor: AuthContext) {
    ensure(actor.principal.type === 'PARTICIPANT' && actor.principal.eventId, 403, 'Participant access is required')
    const { rows } = await this.db.query(
      `SELECT r.id, r.round_no, r.name, r.status,
              EXISTS(SELECT 1 FROM round_tickets t WHERE t.round_id=r.id AND t.participant_profile_id=$2) AS has_ticket
       FROM rounds r WHERE r.event_id=$1 ORDER BY r.round_no`, [actor.principal.eventId, actor.principal.profileId],
    )
    const { rows: [event] } = await this.db.query('SELECT id,name,status FROM events WHERE id=$1', [actor.principal.eventId])
    return { ok: true as const, event, rounds: rows }
  }

  async publicState(roundId: string) { return publicSnapshot(this.db, roundId, false) }

  async adminState(actor: AuthContext, roundId: string) {
    const round = await getRound(this.db, roundId)
    const { rows: [event] } = await this.db.query<{ id: string; name: string; status: string }>('SELECT id,name,status FROM events WHERE id=$1', [round.event_id])
    const { rows: draws } = await this.db.query(
      `SELECT id, seq, key_id, question_snapshot AS question, key_snapshot AS key, manual, drawn_at, revealed_at
       FROM round_draws WHERE round_id=$1 ORDER BY seq`, [roundId],
    )
    const { rows: winners } = await this.db.query(
      `SELECT c.pattern,c.points,u.name,c.reviewed_at AS verified_at FROM round_claims c
       JOIN participant_profiles pp ON pp.id=c.participant_profile_id JOIN users u ON u.id=pp.user_id
       WHERE c.round_id=$1 AND c.status='VERIFIED' ORDER BY c.reviewed_at,c.id`, [roundId],
    )
    const { rows: claims } = await this.db.query(
      `SELECT c.id,c.pattern,c.status,c.points,c.penalty,c.cut_cell_id,c.submitted_at,c.reviewed_at,c.reason,
              u.name AS participant_name, u.email AS participant_email
       FROM round_claims c JOIN participant_profiles pp ON pp.id=c.participant_profile_id
       JOIN users u ON u.id=pp.user_id WHERE c.round_id=$1
       ORDER BY CASE WHEN c.status='PENDING_VERIFICATION' THEN 0 ELSE 1 END, c.submitted_at, c.id`, [roundId],
    )
    const { rows: pendingRows } = await this.db.query<{ count: number }>("SELECT count(*)::int AS count FROM round_claims WHERE round_id=$1 AND status='PENDING_VERIFICATION'", [roundId])
    const { rows: [recovery] } = await this.db.query('SELECT validation_status,validation_issues,last_validated_at,detected_at,resolved_at FROM round_recovery_records WHERE round_id=$1', [roundId])
    return { ok: true as const, event, round: { id: round.id, number: round.round_no, name: round.name, status: round.status }, draws, winners, pending_claims: pendingRows[0]?.count ?? 0, claims, recovery: recovery ?? null }
  }

  async draw(actor: AuthContext, roundId: string, keyId: string | undefined, idempotencyKey: string) {
    return runIdempotently({ db: this.db, actorId: actor.user.id, operation: 'round.draw', key: idempotencyKey, payload: { roundId, keyId: keyId ?? null }, work: async tx => {
      const round = await getRound(tx, roundId, true)
      ensure(round.status === 'ACTIVE', 409, 'Only an active round can draw a question')
      const { rows: candidates } = await tx.query<{ id: string; key_id: string; question: string; value: string }>(
        `SELECT q.id, q.key_id, q.question, k.value FROM round_questions q
         JOIN event_keys k ON k.id=q.key_id
         WHERE q.round_id=$1 AND q.active AND k.active
           AND NOT EXISTS (SELECT 1 FROM round_draws d WHERE d.round_id=q.round_id AND d.key_id=q.key_id)
         ORDER BY q.id`, [roundId],
      )
      ensure(candidates.length, 409, 'No unused active questions remain')
      let selected
      if (keyId) {
        selected = candidates.find(candidate => candidate.key_id === keyId)
        ensure(selected, 409, 'That key is unavailable for this round')
      } else selected = candidates[randomInt(candidates.length)]
      const { rows: seqRows } = await tx.query<{ seq: number }>('SELECT coalesce(max(seq),0)::int + 1 AS seq FROM round_draws WHERE round_id=$1', [roundId])
      const seq = seqRows[0].seq
      const { rows: [draw] } = await tx.query(
        `INSERT INTO round_draws(event_id, round_id, seq, question_id, key_id, question_snapshot, key_snapshot, drawn_by, manual)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, seq, manual, drawn_at, revealed_at`,
        [round.event_id, roundId, seq, selected.id, selected.key_id, selected.question, selected.value, actor.user.id, !!keyId],
      )
      let completed = false
      if (round.closing_seq !== null && seq - round.closing_seq >= round.close_after_calls) {
        await completeRound(tx, round.id, round.event_id)
        completed = true
      }
      await recordAudit(tx, { actorId: actor.user.id, action: keyId ? 'ROUND_MANUAL_DRAW' : 'ROUND_RANDOM_DRAW', resourceType: 'round_draw', resourceId: (draw as { id: string }).id, metadata: { roundId, seq, manual: !!keyId } })
      return { ok: true as const, draw, completed }
    } })
  }

  async reveal(actor: AuthContext, roundId: string, seq: number) {
    return this.db.transaction(async tx => {
      const round = await getRound(tx, roundId, true)
      ensure(['ACTIVE','PAUSED'].includes(round.status), 409, 'Round is not in a revealable state')
      const { rows: [draw] } = await tx.query<{ id: string; seq: number; question_snapshot: string; key_snapshot: string; revealed_at: Date | null }>(
        `UPDATE round_draws SET revealed_at=coalesce(revealed_at, now())
         WHERE round_id=$1 AND seq=$2 RETURNING id, seq, question_snapshot, key_snapshot, revealed_at`, [roundId, seq],
      )
      ensure(draw, 404, 'Draw not found')
      await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_DRAW_REVEALED', resourceType: 'round_draw', resourceId: draw.id, metadata: { roundId, seq } })
      return { ok: true as const, draw: { seq: draw.seq, question: draw.question_snapshot, key: draw.key_snapshot, revealed_at: draw.revealed_at } }
    })
  }

  async mark(actor: AuthContext, roundId: string, keyId: string, marked: boolean, idempotencyKey: string) {
    ensure(actor.principal.type === 'PARTICIPANT' && actor.principal.eventId, 403, 'Participant access is required')
    return runIdempotently({ db: this.db, actorId: actor.user.id, operation: `round.mark.${marked ? 'set' : 'clear'}`, key: idempotencyKey, payload: { roundId, keyId, marked }, work: async tx => {
      const round = await getRound(tx, roundId, true)
      ensure(round.event_id === actor.principal.eventId, 404, 'Round not found for this participant')
      ensure(round.status === 'ACTIVE', 409, 'Ticket marking is available only during an active round')
      const { rows: [ticket] } = await tx.query<{ id: string; cells: TicketCells; marked_cell_ids: string[]; cut_cell_ids: string[] }>(
        'SELECT id, cells, marked_cell_ids, cut_cell_ids FROM round_tickets WHERE round_id=$1 AND participant_profile_id=$2 FOR UPDATE',
        [roundId, actor.principal.profileId],
      )
      ensure(ticket, 404, 'Ticket has not been assigned')
      ensure(ticketValues(ticket.cells).includes(keyId), 422, 'That key is not on your ticket')
      if (marked) {
        ensure(!ticket.cut_cell_ids.includes(keyId), 422, 'That ticket key was cut after an incorrect claim')
        const { rows: draws } = await tx.query('SELECT id FROM round_draws WHERE round_id=$1 AND key_id=$2 AND revealed_at IS NOT NULL', [roundId, keyId])
        ensure(draws.length, 422, 'That ticket key has not been revealed')
      }
      const updated = marked
        ? [...new Set([...ticket.marked_cell_ids, keyId])]
        : ticket.marked_cell_ids.filter(id => id !== keyId)
      await tx.query('UPDATE round_tickets SET marked_cell_ids=$2, updated_at=now() WHERE id=$1', [ticket.id, updated])
      return { ok: true as const, marked_cell_ids: updated }
    } })
  }

  async submitClaim(actor: AuthContext, roundId: string, pattern: Pattern, idempotencyKey: string) {
    ensure(actor.principal.type === 'PARTICIPANT' && actor.principal.eventId, 403, 'Participant access is required')
    return runIdempotently({ db: this.db, actorId: actor.user.id, operation: 'round.claim.submit', key: idempotencyKey, payload: { roundId, pattern }, work: async tx => {
      const round = await getRound(tx, roundId, true)
      ensure(round.event_id === actor.principal.eventId, 404, 'Round not found for this participant')
      ensure(round.status === 'ACTIVE', 409, 'Claims can be submitted only during an active round')
      const { rows: [config] } = await tx.query<{ enabled: boolean; status: string }>('SELECT enabled, status FROM round_patterns WHERE round_id=$1 AND pattern=$2', [roundId, pattern])
      ensure(config?.enabled, 422, 'This claim pattern is not enabled')
      ensure(config.status === 'OPEN', 409, 'This claim pattern is closed')
      const { rows: [ticket] } = await tx.query<{ id: string; cells: TicketCells; marked_cell_ids: string[]; cut_cell_ids: string[] }>(
        'SELECT id, cells, marked_cell_ids, cut_cell_ids FROM round_tickets WHERE round_id=$1 AND participant_profile_id=$2 FOR UPDATE',
        [roundId, actor.principal.profileId],
      )
      ensure(ticket, 404, 'Ticket has not been assigned')
      const { rows: existing } = await tx.query('SELECT id, status, submitted_at, points, penalty, cut_cell_id, reason FROM round_claims WHERE round_id=$1 AND participant_profile_id=$2 AND pattern=$3', [roundId, actor.principal.profileId, pattern])
      if (existing.length) return { ok: true as const, claim: existing[0], duplicate: true, accepted: existing[0].status === 'PENDING_VERIFICATION' || existing[0].status === 'VERIFIED' }
      const eligible = isClaimEligible(pattern, ticket.cells, ticket.marked_cell_ids)
      if (pattern === 'second_full_house') {
        const { rows: prior } = await tx.query('SELECT id FROM round_claims WHERE round_id=$1 AND pattern=\'full_house\' AND status=\'VERIFIED\' LIMIT 1', [roundId])
        ensure(prior.length, 422, 'A verified Full House is required first')
      }
      if (!eligible) {
        const penalty = round.wrong_claim_penalty
        const candidates = ticket.marked_cell_ids.filter(id => !ticket.cut_cell_ids.includes(id))
        const cutCellId = candidates.length ? candidates[randomInt(candidates.length)] : null
        if (cutCellId) await tx.query(
          'UPDATE round_tickets SET cut_cell_ids=array_append(cut_cell_ids,$2), marked_cell_ids=array_remove(marked_cell_ids,$2), updated_at=now() WHERE id=$1',
          [ticket.id, cutCellId],
        )
        const { rows: [score] } = await tx.query<{ score: number; wrong_claims: number }>(
          `INSERT INTO round_player_scores(round_id,event_id,participant_profile_id,score,wrong_claims)
           VALUES ($1,$2,$3,0,1) ON CONFLICT(round_id,participant_profile_id) DO UPDATE SET
             score=greatest(0,round_player_scores.score-$4), wrong_claims=round_player_scores.wrong_claims+1, updated_at=now()
           RETURNING score,wrong_claims`, [roundId, round.event_id, actor.principal.profileId, penalty],
        )
        const { rows: [claim] } = await tx.query(
          `INSERT INTO round_claims(event_id,round_id,participant_profile_id,pattern,status,points,penalty,cut_cell_id,reason)
           VALUES ($1,$2,$3,$4,'REJECTED',$5,$6,$7,'Not valid on your ticket')
           RETURNING id,pattern,status,submitted_at,points,penalty,cut_cell_id,reason`,
          [round.event_id, roundId, actor.principal.profileId, pattern, -penalty, penalty, cutCellId],
        )
        await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_CLAIM_INVALID', resourceType: 'round_claim', resourceId: (claim as { id: string }).id, metadata: { roundId, pattern, penalty, cut: !!cutCellId } })
        return { ok: true as const, accepted: false, duplicate: false, claim, penalty, cut_cell_id: cutCellId, score: score.score, wrong_claims: score.wrong_claims }
      }
      const { rows: [claim] } = await tx.query(
        `INSERT INTO round_claims(event_id, round_id, participant_profile_id, pattern, status)
         VALUES ($1,$2,$3,$4,'PENDING_VERIFICATION') RETURNING id, pattern, status, submitted_at, points, penalty, reason`,
        [round.event_id, roundId, actor.principal.profileId, pattern],
      )
      await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_CLAIM_SUBMITTED', resourceType: 'round_claim', resourceId: (claim as { id: string }).id, metadata: { roundId, pattern } })
      return { ok: true as const, accepted: true, claim, duplicate: false }
    } })
  }

  async reviewClaim(actor: AuthContext, claimId: string, decision: 'verify'|'reject', reason: string | undefined, idempotencyKey: string) {
    return runIdempotently({ db: this.db, actorId: actor.user.id, operation: 'round.claim.review', key: idempotencyKey, payload: { claimId, decision, reason: reason ?? null }, work: async tx => {
      const { rows: [preliminary] } = await tx.query<{ round_id: string }>('SELECT round_id FROM round_claims WHERE id=$1', [claimId])
      ensure(preliminary, 404, 'Claim not found')
      const round = await getRound(tx, preliminary.round_id, true)
      const { rows: [claim] } = await tx.query<{ id: string; participant_profile_id: string; pattern: Pattern; status: string }>('SELECT * FROM round_claims WHERE id=$1 FOR UPDATE', [claimId])
      ensure(claim, 404, 'Claim not found')
      if (claim.status !== 'PENDING_VERIFICATION') return { ok: true as const, round_id: round.id, claim, duplicate: true }
      const { rows: [config] } = await tx.query<{ max_winners: number; status: string; enabled: boolean; points: number }>('SELECT max_winners, status, enabled, points FROM round_patterns WHERE round_id=$1 AND pattern=$2 FOR UPDATE', [round.id, claim.pattern])
      ensure(config, 404, 'Pattern configuration not found')
      if (decision === 'reject') {
        const { rows: [updated] } = await tx.query(
          `UPDATE round_claims SET status='REJECTED', reviewed_at=now(), reviewed_by=$2, reason=$3 WHERE id=$1
           RETURNING id, pattern, status, reviewed_at, reason`, [claimId, actor.user.id, reason?.trim() || 'Rejected by administrator'],
        )
        await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_CLAIM_REJECTED', resourceType: 'round_claim', resourceId: claimId, metadata: { roundId: round.id, pattern: claim.pattern } })
        return { ok: true as const, round_id: round.id, claim: updated }
      }
      const { rows: [ticket] } = await tx.query<{ cells: TicketCells; marked_cell_ids: string[] }>(
        'SELECT cells, marked_cell_ids FROM round_tickets WHERE round_id=$1 AND participant_profile_id=$2 FOR UPDATE', [round.id, claim.participant_profile_id],
      )
      ensure(ticket, 404, 'Ticket not found')
      ensure(isClaimEligible(claim.pattern, ticket.cells, ticket.marked_cell_ids), 409, 'Claim is no longer eligible from the saved ticket marks')
      const { rows: winners } = await tx.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM round_claims WHERE round_id=$1 AND pattern=$2 AND status=\'VERIFIED\'', [round.id, claim.pattern],
      )
      if (!config.enabled || config.status === 'CLOSED' || (winners[0]?.count ?? 0) >= config.max_winners) {
        const { rows: [updated] } = await tx.query(
          `UPDATE round_claims SET status='REJECTED_PATTERN_ALREADY_CLOSED', reviewed_at=now(), reviewed_by=$2, reason='Winner capacity is closed' WHERE id=$1
           RETURNING id, pattern, status, reviewed_at, reason`, [claimId, actor.user.id],
        )
        await tx.query("UPDATE round_patterns SET status='CLOSED' WHERE round_id=$1 AND pattern=$2", [round.id, claim.pattern])
        await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_CLAIM_CAPACITY_REJECTED', resourceType: 'round_claim', resourceId: claimId, metadata: { roundId: round.id, pattern: claim.pattern } })
        return { ok: true as const, round_id: round.id, claim: updated }
      }
      const { rows: [updated] } = await tx.query(
        `UPDATE round_claims SET status='VERIFIED', points=$3, reviewed_at=now(), reviewed_by=$2, reason=NULL WHERE id=$1
         RETURNING id, pattern, status, points, reviewed_at`, [claimId, actor.user.id, config.points],
      )
      await tx.query(
        `INSERT INTO round_player_scores(round_id,event_id,participant_profile_id,score,wrong_claims)
         VALUES ($1,$2,$3,$4,0) ON CONFLICT(round_id,participant_profile_id) DO UPDATE SET
         score=round_player_scores.score+EXCLUDED.score,updated_at=now()`,
        [round.id, round.event_id, claim.participant_profile_id, config.points],
      )
      if ((winners[0]?.count ?? 0) + 1 >= config.max_winners) {
        await tx.query("UPDATE round_patterns SET status='CLOSED' WHERE round_id=$1 AND pattern=$2", [round.id, claim.pattern])
      }
      if (claim.pattern === 'full_house') {
        await tx.query('UPDATE rounds SET closing_seq=coalesce(closing_seq,(SELECT max(seq) FROM round_draws WHERE round_id=$1)),updated_at=now() WHERE id=$1', [round.id])
      } else if (claim.pattern === 'second_full_house') {
        await completeRound(tx, round.id, round.event_id)
      }
      await recordAudit(tx, { actorId: actor.user.id, action: 'ROUND_CLAIM_VERIFIED', resourceType: 'round_claim', resourceId: claimId, metadata: { roundId: round.id, pattern: claim.pattern } })
      return { ok: true as const, round_id: round.id, claim: updated }
    } })
  }
}
