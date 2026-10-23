import { Router, type Request } from 'express'
import { z } from 'zod'
import type { AuthService } from '../auth/service'
import { requireAuth, requireRole } from '../auth/middleware'
import type { OperationsService } from './service'

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  actorId: z.string().uuid().optional(),
  action: z.string().min(1).max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
}).strict()

function routeQuery(req: Request) {
  return auditQuery.parse(req.query)
}

export function adminOperationsRoutes(operations: OperationsService, auth: AuthService, socketCount: () => number) {
  const router = Router()
  router.use(requireAuth(auth), requireRole(['ADMIN']))
  router.get('/dashboard', async (_req, res, next) => {
    try { res.json(await operations.dashboard(socketCount())) } catch (error) { next(error) }
  })
  router.get('/audit', async (req, res, next) => {
    try { res.json(await operations.audit(routeQuery(req))) } catch (error) { next(error) }
  })
  return router
}

export function superAdminOperationsRoutes(operations: OperationsService, auth: AuthService) {
  const router = Router()
  router.use(requireAuth(auth), requireRole(['SUPER_ADMIN']))
  router.get('/system', async (_req, res, next) => {
    try { res.json(await operations.system()) } catch (error) { next(error) }
  })
  return router
}
