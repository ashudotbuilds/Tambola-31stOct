import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { AuthService } from '../auth/service'
import { requireAuth, requireRole } from '../auth/middleware'
import type { EventService } from './service'
import { parseParticipantCsv } from './csv'
import * as validate from './validation'
import { AppError } from '../../errors'

function idempotencyKey(req: import('express').Request) {
  const key = req.header('Idempotency-Key')
  if (!key || !/^[A-Za-z0-9._~-]{8,128}$/.test(key)) throw new AppError(400, 'Idempotency-Key header is required for this action')
  return key
}

export function adminEventRoutes(events: EventService, auth: AuthService) {
  const router = Router()
  router.use(requireAuth(auth), requireRole(['ADMIN']))
  const credentialLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false })

  router.get('/events', async (req, res, next) => {
    try { res.json(await events.list(req.auth!)) } catch (error) { next(error) }
  })
  router.get('/events/:eventId/participants', async (req, res, next) => {
    try { res.json(await events.listParticipants(validate.eventId.parse(req.params.eventId))) } catch (error) { next(error) }
  })
  router.post('/events/:eventId/participants/:profileId/credentials', credentialLimiter, async (req, res, next) => {
    try {
      const eventId = validate.eventId.parse(req.params.eventId)
      const profileId = validate.eventId.parse(req.params.profileId)
      res.json(await events.issueParticipantCredential(req.auth!, eventId, profileId))
    } catch (error) { next(error) }
  })
  router.post('/events', async (req, res, next) => {
    try {
      const body = validate.createEventBody.parse(req.body)
      res.status(201).json(await events.create(req.auth!, body))
    } catch (error) { next(error) }
  })
  router.post('/events/:eventId/participants/import', async (req, res, next) => {
    try {
      const eventId = validate.eventId.parse(req.params.eventId)
      const rows = typeof req.body === 'string'
        ? parseParticipantCsv(req.body)
        : req.body && Array.isArray(req.body.rows) ? req.body.rows : null
      if (!rows) throw new AppError(400, 'Provide CSV text or a JSON object containing a rows array')
      if (rows.length > 5000) throw new AppError(413, 'An import can contain at most 5,000 participant rows')
      res.json(await events.importParticipants(req.auth!, eventId, rows, idempotencyKey(req)))
    } catch (error) { next(error) }
  })
  return router
}
