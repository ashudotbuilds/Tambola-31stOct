import { createServer } from 'node:http'
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
import { attachRooms, roomName } from './realtime/rooms'

export function createApplication(db: Database, options: { origins: string[]; trustProxyHops?: number }) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', options.trustProxyHops ?? 0)
  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      if (!origin || options.origins.includes(origin)) callback(null, true)
      else callback(new AppError(403, 'Origin is not allowed'))
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }))
  app.use(express.json({ limit: '2mb' }))
  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.get('/ready', async (_req, res) => {
    await db.query('SELECT id FROM games LIMIT 0')
    res.json({ ok: true })
  })
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 10_000, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { ok: false, error: 'Too many requests. Please wait a minute.' } }))
  const server = createServer(app)
  const io = new Server(server, {
    cors: { origin: options.origins },
    allowRequest: (req, callback) => callback(null, !req.headers.origin || options.origins.includes(req.headers.origin)),
    maxHttpBufferSize: 16_384,
  })
  const games = new GameService(db)
  const claims = new ClaimService(db)
  attachRooms(io, games)
  app.use('/api/games', gameRoutes(games, claims, id => io.to(roomName(id)).emit('game_changed')))
  app.use((_req, res) => { res.status(404).json({ ok: false, error: 'Route not found' }) })
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({ ok: false, error: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') })
    } else if (error instanceof AppError) {
      res.status(error.status).json({ ok: false, error: error.message })
    } else if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
      res.status(error.type === 'entity.too.large' ? 413 : 400).json({ ok: false, error: 'Invalid request body' })
    } else {
      // Avoid logging query parameters, request bodies, or connection strings.
      console.error('Request failed', { code: error?.code ?? 'unknown' })
      res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' })
    }
  }
  app.use(errorHandler)
  return { app, server, io, games, claims }
}
