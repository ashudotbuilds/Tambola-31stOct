import { recordAudit } from './modules/auth/repository'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import express, { type ErrorRequestHandler } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { Server } from 'socket.io'
import { ZodError } from 'zod'
import type { Database } from './db/database'
import { AppError } from './errors'
import { GameService } from './modules/games/service'
import { ClaimService } from './modules/games/claims'
import { gameRoutes } from './modules/games/routes'
import { AuthService } from './modules/auth/service'
import { authRoutes, superAdminRoutes } from './modules/auth/routes'
import { ParticipantService } from './modules/participants/service'
import { participantRoutes } from './modules/participants/routes'
import { attachRooms, roomName, adminRoomName } from './realtime/rooms'
import { EmailAdapter, type EmailOptions } from './modules/email/adapter'
import { OperationsService } from './modules/operations/service'
import { adminOperationsRoutes, superAdminOperationsRoutes } from './modules/operations/routes'
import { parse as parseCookies } from 'cookie'

export function createApplication(
  db: Database,
  options: { origins: string[]; trustProxyHops?: number; bootstrapSecret?: string; email?: EmailOptions; demoAccounts?: Array<{ id: string; name: string; email: string; role: string }> },
) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', options.trustProxyHops ?? 0)
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID()
    res.setHeader('X-Request-Id', res.locals.requestId)
    next()
  })
  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      if (!origin || options.origins.includes(origin)) callback(null, true)
      else callback(new AppError(403, 'Origin is not allowed'))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-bootstrap-secret', 'Idempotency-Key'],
  }))
  app.use((req, res, next) => {
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    const hasSessionCookie = req.headers.cookie?.split(';').some(cookie => cookie.trim().startsWith('tt_session='))
    if (isMutation && hasSessionCookie && !options.origins.includes(req.header('origin') ?? '')) {
      res.status(403).json({ ok: false, error: 'Request origin is not allowed' })
      return
    }
    next()
  })
  app.use(express.json({ limit: '2mb' }))
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }))
  app.use('/api/v1', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.get('/ready', async (_req, res) => {
    await db.query('SELECT id, deleted_at FROM games LIMIT 0')
    await db.query('SELECT actor_name, actor_email FROM audit_logs LIMIT 0')
    await db.query('SELECT id FROM users LIMIT 0')
    await db.query('SELECT id FROM events LIMIT 0')
    await db.query('SELECT id FROM participant_profiles LIMIT 0')
    await db.query('SELECT id FROM idempotency_records LIMIT 0')
    await db.query('SELECT participant_profile_id FROM participant_credential_deliveries LIMIT 0')
    await db.query('SELECT admin_profile_id FROM admin_credential_deliveries LIMIT 0')
    res.json({ ok: true })
  })
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 10_000, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { ok: false, error: 'Too many requests. Please wait a minute.' } }))
  const server = createServer(app)
  const io = new Server(server, {
    cors: { origin: options.origins, credentials: true },
    allowRequest: (req, callback) => callback(null, !req.headers.origin || options.origins.includes(req.headers.origin)),
    maxHttpBufferSize: 16_384,
  })
  const games = new GameService(db)
  const claims = new ClaimService(db)
  const email = new EmailAdapter(options.email)
  const auth = new AuthService(db, { bootstrapSecret: options.bootstrapSecret, email })
  const participants = new ParticipantService(db, email)
  const operations = new OperationsService(db)

  attachRooms(io, games, auth)
  app.use('/api/games', async (req, _res, next) => {
    try {
      const token = parseCookies(req.headers.cookie ?? '').tt_session
      if (!token) throw new AppError(401, 'Authentication is required')
      req.auth = await auth.authenticate(token)
      next()
    } catch (error) { next(error) }
  }, gameRoutes(games, claims, (id, deleted, full) => {
    if (deleted) io.to(roomName(id)).emit('game_deleted')
    io.to(roomName(id)).emit('game_changed', { full: Boolean(full) })
    io.to(adminRoomName).emit('dashboard_changed')
  }))
  app.use('/api/v1/auth', authRoutes(auth))
  app.get('/api/v1/demo/accounts', (_req,res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!options.demoAccounts) { res.status(404).json({ok:false}); return }
    res.json({ok:true,accounts:options.demoAccounts})
  })
  app.use('/api/v1/super-admin', superAdminRoutes(auth))
  app.use('/api/v1/super-admin', superAdminOperationsRoutes(operations, auth))
  app.use('/api/v1/admin', participantRoutes(participants, auth))
  app.use('/api/v1/admin', adminOperationsRoutes(operations, auth, () => io.engine.clientsCount))
  app.use((_req, res) => { res.status(404).json({ ok: false, error: 'Route not found' }) })
  const errorHandler: ErrorRequestHandler = async (error, req, res, _next) => {
    if (error instanceof AppError && [401, 403].includes(error.status) && req.auth) {
      const gameId = /^\/api\/games\/([a-f0-9-]{36})(?:\/|$)/i.exec(req.originalUrl)?.[1]
      try { await recordAudit(db, { actorId: req.auth.user.id, action: 'ACCESS_DENIED', resourceType: gameId ? 'game' : 'system',
        resourceId: gameId, metadata: { reason: error.message, method: req.method }, ipAddress: req.ip, userAgent: req.header('user-agent') }) }
      catch { console.error('Could not record access denial audit') }
    }
    const requestId = String(res.locals.requestId ?? '')
    const send = (status: number, code: string, message: string) => res.status(status).json({
      ok: false,
      error: { code, message },
      requestId,
    })
    if (error instanceof ZodError) {
      send(400, 'BAD_REQUEST', error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
    } else if (error instanceof AppError) {
      const code = error.status === 401 ? 'UNAUTHENTICATED'
        : error.status === 403 ? 'FORBIDDEN'
          : error.status === 404 ? 'NOT_FOUND'
            : error.status === 409 ? 'CONFLICT'
              : error.status === 422 ? 'INELIGIBLE'
                : error.status === 429 ? 'RATE_LIMITED'
                  : error.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'BAD_REQUEST'
      send(error.status, code, error.message)
    } else if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
      const status = error.type === 'entity.too.large' ? 413 : 400
      send(status, status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', 'Invalid request body')
    } else {
      // Avoid logging query parameters, request bodies, or connection strings.
      console.error('Request failed', { requestId, code: error?.code ?? 'unknown' })
      send(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
    }
  }
  app.use(errorHandler)
  return { app, server, io, games, claims, auth, participants, operations }
}
