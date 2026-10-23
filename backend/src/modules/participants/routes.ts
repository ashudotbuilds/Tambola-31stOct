import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import type { AuthService } from '../auth/service'
import { requireAuth, requireRole } from '../auth/middleware'
import type { ParticipantService } from './service'
import { parseParticipantCsv } from './csv'
import { AppError } from '../../errors'

export function participantRoutes(participants: ParticipantService, auth: AuthService) {
  const router = Router()
  router.use(requireAuth(auth), requireRole(['ADMIN']))
  const credentialLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false })
  router.get('/participants', async (_req, res) => { res.json(await participants.listParticipants()) })
  router.post('/participants/:profileId/credentials', credentialLimit, async (req, res) => {
    res.json(await participants.issueParticipantCredential(req.auth!, z.string().uuid().parse(req.params.profileId)))
  })
  router.post('/participants/import', async (req, res) => {
    const key = req.header('Idempotency-Key')
    if (!key || !/^[A-Za-z0-9._~-]{8,128}$/.test(key)) throw new AppError(400, 'Idempotency-Key header is required for this action')
    const rows = typeof req.body === 'string' ? parseParticipantCsv(req.body) : req.body && Array.isArray(req.body.rows) ? req.body.rows : null
    if (!rows) throw new AppError(400, 'Provide CSV text or a JSON object containing a rows array')
    if (rows.length > 5000) throw new AppError(413, 'An import can contain at most 5,000 participant rows')
    res.json(await participants.importParticipants(req.auth!, rows, key))
  })
  return router
}
