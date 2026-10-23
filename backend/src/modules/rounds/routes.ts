import { Router, type Request } from 'express'
import type { AuthService } from '../auth/service'
import { requireAuth, requireRole } from '../auth/middleware'
import type { RoundService } from './service'
import * as validate from './validation'
import { AppError } from '../../errors'
import type { RecoveryService } from '../recovery/service'

function idempotencyKey(req: Request) {
  const key = req.header('Idempotency-Key')
  if (!key || !/^[A-Za-z0-9._~-]{8,128}$/.test(key)) throw new AppError(400, 'Idempotency-Key header is required for this action')
  return key
}

export function adminRoundRoutes(rounds: RoundService, auth: AuthService, changed: (roundId: string) => void) {
  const router = Router()
  router.use(requireAuth(auth), requireRole(['ADMIN']))
  router.get('/events/:eventId/rounds', async (req, res, next) => {
    try { res.json(await rounds.list(req.auth!, validate.uuid.parse(req.params.eventId))) } catch (error) { next(error) }
  })
  router.post('/events/:eventId/rounds', async (req, res, next) => {
    try {
      const { name } = validate.createRoundBody.parse(req.body)
      res.status(201).json(await rounds.create(req.auth!, validate.uuid.parse(req.params.eventId), name))
    } catch (error) { next(error) }
  })
  router.get('/events/:eventId/keys', async (req, res, next) => {
    try { res.json(await rounds.listKeys(validate.uuid.parse(req.params.eventId))) } catch (error) { next(error) }
  })
  router.post('/events/:eventId/keys', async (req, res, next) => {
    try {
      const { value } = validate.createKeyBody.parse(req.body)
      res.status(201).json(await rounds.addKey(req.auth!, validate.uuid.parse(req.params.eventId), value))
    } catch (error) { next(error) }
  })
  router.get('/rounds/:roundId/questions', async (req, res, next) => {
    try { res.json(await rounds.listQuestions(validate.uuid.parse(req.params.roundId))) } catch (error) { next(error) }
  })
  router.get('/rounds/:roundId/state', async (req, res, next) => {
    try { res.json(await rounds.adminState(req.auth!, validate.uuid.parse(req.params.roundId))) } catch (error) { next(error) }
  })
  router.post('/rounds/:roundId/draws', async (req, res, next) => {
    try {
      const body = validate.drawBody.parse(req.body ?? {})
      const result = await rounds.draw(req.auth!, validate.uuid.parse(req.params.roundId), body.keyId, idempotencyKey(req))
      changed(validate.uuid.parse(req.params.roundId)); res.json(result)
    } catch (error) { next(error) }
  })
  router.post('/rounds/:roundId/draws/reveal', async (req, res, next) => {
    try {
      const { seq } = validate.revealBody.parse(req.body)
      const roundId = validate.uuid.parse(req.params.roundId)
      const result = await rounds.reveal(req.auth!, roundId, seq)
      changed(roundId); res.json(result)
    } catch (error) { next(error) }
  })
  router.get('/rounds/:roundId/claims', async (req, res, next) => {
    try { res.json(await rounds.adminState(req.auth!, validate.uuid.parse(req.params.roundId))) } catch (error) { next(error) }
  })
  router.post('/claims/:claimId/review', async (req, res, next) => {
    try {
      const { decision, reason } = validate.reviewBody.parse(req.body)
      const result = await rounds.reviewClaim(req.auth!, validate.uuid.parse(req.params.claimId), decision, reason, idempotencyKey(req))
      changed(result.round_id)
      res.json(result)
    } catch (error) { next(error) }
  })
  router.post('/rounds/:roundId/questions', async (req, res, next) => {
    try {
      const { keyId, question } = validate.createQuestionBody.parse(req.body)
      res.status(201).json(await rounds.addQuestion(req.auth!, validate.uuid.parse(req.params.roundId), keyId, question))
    } catch (error) { next(error) }
  })
  router.patch('/rounds/:roundId/patterns/:pattern', async (req, res, next) => {
    try {
      const pattern = validate.pattern.parse(req.params.pattern)
      const body = validate.patternBody.parse(req.body)
      res.json(await rounds.setPattern(req.auth!, validate.uuid.parse(req.params.roundId), pattern, body))
    } catch (error) { next(error) }
  })
  router.post('/rounds/:roundId/tickets/generate', async (req, res, next) => {
    try { res.json(await rounds.generateTickets(req.auth!, validate.uuid.parse(req.params.roundId), idempotencyKey(req))) } catch (error) { next(error) }
  })
  router.post('/rounds/:roundId/:action', async (req, res, next) => {
    try {
      const action = req.params.action
      if (!['ready','start','pause','resume','complete','cancel'].includes(action)) throw new AppError(404, 'Round action not found')
      const roundId = validate.uuid.parse(req.params.roundId)
      const result = await rounds.changeStatus(req.auth!, roundId, action as 'ready'|'start'|'pause'|'resume'|'complete'|'cancel', idempotencyKey(req))
      changed(roundId); res.json(result)
    } catch (error) { next(error) }
  })
  return router
}

export function participantRoundRoutes(rounds: RoundService, auth: AuthService, changed: (roundId: string) => void) {
  const router = Router()
  router.use(requireAuth(auth), requireRole(['PARTICIPANT']))
  router.get('/', async (req, res, next) => {
    try { res.json(await rounds.myRounds(req.auth!)) } catch (error) { next(error) }
  })
  router.get('/:roundId', async (req, res, next) => {
    try { res.json(await rounds.myTicket(req.auth!, validate.uuid.parse(req.params.roundId))) } catch (error) { next(error) }
  })
  router.get('/:roundId/ticket', async (req, res, next) => {
    try { res.json(await rounds.myTicket(req.auth!, validate.uuid.parse(req.params.roundId))) } catch (error) { next(error) }
  })
  router.post('/:roundId/marks', async (req, res, next) => {
    try {
      const { keyId } = validate.markBody.parse(req.body)
      const roundId = validate.uuid.parse(req.params.roundId)
      const result = await rounds.mark(req.auth!, roundId, keyId, true, idempotencyKey(req))
      changed(roundId)
      res.json(result)
    } catch (error) { next(error) }
  })
  router.delete('/:roundId/marks/:keyId', async (req, res, next) => {
    try {
      const roundId = validate.uuid.parse(req.params.roundId)
      const result = await rounds.mark(req.auth!, roundId, validate.uuid.parse(req.params.keyId), false, idempotencyKey(req))
      changed(roundId)
      res.json(result)
    } catch (error) { next(error) }
  })
  router.post('/:roundId/claims', async (req, res, next) => {
    try {
      const { pattern } = validate.claimBody.parse(req.body)
      const roundId = validate.uuid.parse(req.params.roundId)
      const result = await rounds.submitClaim(req.auth!, roundId, pattern, idempotencyKey(req))
      changed(roundId); res.status(result.duplicate ? 200 : 201).json(result)
    } catch (error) { next(error) }
  })
  return router
}

export function publicRoundRoutes(rounds: RoundService) {
  const router = Router()
  router.get('/:roundId', async (req, res, next) => {
    try { res.json(await rounds.publicState(validate.uuid.parse(req.params.roundId))) } catch (error) { next(error) }
  })
  return router
}

export function superAdminRecoveryRoutes(recovery: RecoveryService, auth: AuthService, changed: (roundId: string) => void) {
  const router = Router()
  router.use(requireAuth(auth), requireRole(['SUPER_ADMIN']))
  router.get('/rounds/:roundId/recovery', async (req, res, next) => {
    try { res.json(await recovery.inspect(validate.uuid.parse(req.params.roundId))) } catch (error) { next(error) }
  })
  router.post('/rounds/:roundId/recover', async (req, res, next) => {
    try {
      const roundId = validate.uuid.parse(req.params.roundId)
      const result = await recovery.recover(req.auth!, roundId)
      changed(roundId); res.json(result)
    } catch (error) { next(error) }
  })
  return router
}
