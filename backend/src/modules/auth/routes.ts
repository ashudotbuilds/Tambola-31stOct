import { Router, type Request, type CookieOptions } from 'express'
import rateLimit from 'express-rate-limit'
import type { AuthService } from './service'
import { extractSessionToken, requireAuth, requireRole } from './middleware'
import * as validate from './validation'
import { z } from 'zod'
import { verifyPassword, hashPassword } from './password'
import { findUserById, recordAudit } from './repository'
import { ensure, AppError } from '../../errors'

function sessionCookie(req: Request): CookieOptions {
  // Also handle manually configured HTTPS deployments without NODE_ENV set.
  const secure = req.secure || process.env.NODE_ENV === 'production' || req.get('origin')?.startsWith('https://') === true
  return { httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', path: '/' }
}

export function authRoutes(auth: AuthService) {
  const router = Router()
  router.patch('/profile', requireAuth(auth), async (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().trim().min(1).max(24),
          email: z.string().trim().email().max(255),
          currentPassword: z.string().min(1).max(128),
          password: z.string().min(8).max(128).optional(),
        })
        .parse(req.body)
      const user = await findUserById(auth.db, req.auth!.user.id)
      ensure(
        user &&
          (await verifyPassword(user.password_hash, input.currentPassword)),
        401,
        'Current password is incorrect',
      )
      const passwordHash = input.password
        ? await hashPassword(input.password)
        : user.password_hash
      await auth.db.transaction(async (tx) => {
        await tx.query(
          'UPDATE users SET name=$2,email=$3,password_hash=$4,updated_at=now() WHERE id=$1',
          [user.id, input.name, input.email, passwordHash],
        )
        if (input.password)
          await tx.query(
            'UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2',
            [user.id, req.auth!.session.id],
          )
        await recordAudit(tx, {
          actorId: user.id,
          action: 'PROFILE_UPDATED',
          resourceType: 'user',
          resourceId: user.id,
        })
      })
      res.json({ ok: true })
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        return next(new AppError(409, 'That email is already in use'))
      next(error)
    }
  })

  const loginLimiter = rateLimit({
    windowMs: 60_000,
    limit: 15,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      ok: false,
      error: 'Too many login attempts. Please wait a minute.',
    },
  })

  const bootstrapLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      ok: false,
      error: 'Too many bootstrap attempts. Please wait a minute.',
    },
  })

  // Bootstrap Super Admin
  router.post(
    '/bootstrap-super-admin',
    bootstrapLimiter,
    async (req, res, next) => {
      try {
        const secret = req.header('x-bootstrap-secret')
        const body = validate.bootstrapBody.parse(req.body)
        const result = await auth.bootstrapSuperAdmin(secret, body, {
          ip: req.ip,
          userAgent: req.header('user-agent'),
        })
        res.status(201).json(result)
      } catch (err) {
        next(err)
      }
    },
  )

  // Login
  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const { email, password } = validate.loginBody.parse(req.body)
      const result = await auth.login(email, password, {
        ip: req.ip,
        userAgent: req.header('user-agent'),
      })

      // Set HttpOnly session cookie
      res.cookie('tt_session', result.token, {
        ...sessionCookie(req),
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })

      // Keep the bearer credential out of JavaScript. The HttpOnly cookie is
      // the browser session boundary; the service retains the token only long
      // enough to persist its hash and issue the cookie.
      res.json({
        ok: result.ok,
        user: result.user,
        principal: result.principal,
      })
    } catch (err) {
      next(err)
    }
  })

  // Logout
  router.post('/logout', async (req, res, next) => {
    try {
      const token = extractSessionToken(req)
      if (token) {
        await auth.logout(token, req.auth?.user.id)
      }
      res.clearCookie('tt_session', sessionCookie(req))
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // Current session context
  router.get('/me', requireAuth(auth), (req, res) => {
    res.json({
      ok: true,
      user: req.auth!.user,
      principal: req.auth!.principal,
    })
  })

  return router
}

export function superAdminRoutes(auth: AuthService) {
  const router = Router()
  const credentialLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  })

  router.use(requireAuth(auth))
  router.use(requireRole(['SUPER_ADMIN']))

  router.get('/admins', async (req, res, next) => {
    try {
      const admins = await auth.listAdmins(req.auth!)
      res.json({ ok: true, admins })
    } catch (err) {
      next(err)
    }
  })

  router.post('/admins', async (req, res, next) => {
    try {
      const body = validate.createAdminBody.parse(req.body)
      const created = await auth.createAdmin(req.auth!, body)
      res.status(201).json(created)
    } catch (err) {
      next(err)
    }
  })

  router.delete('/admins/:id', async (req, res, next) => {
    try {
      const profileId = validate.uuid.parse(req.params.id)
      const result = await auth.deleteAdmin(req.auth!, profileId)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.post(
    '/admins/:id/credentials',
    credentialLimiter,
    async (req, res, next) => {
      try {
        const profileId = validate.uuid.parse(req.params.id)
        res.json(await auth.regenerateAdminCredential(req.auth!, profileId))
      } catch (err) {
        next(err)
      }
    },
  )

  return router
}
