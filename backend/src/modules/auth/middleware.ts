import type { Request, Response, NextFunction } from 'express'
import { parse as parseCookies } from 'cookie'
import type { AuthService } from './service'
import type { AuthContext, PrincipalType } from './models'
import { AppError } from '../../errors'

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

export function extractSessionToken(req: Request): string | undefined {
  // 1. Authorization header: Bearer <hex>
  const authorization = req.header('authorization')
  if (authorization) {
    const match = /^Bearer ([a-f0-9]{64})$/i.exec(authorization.trim())
    if (match) return match[1]
  }

  // 2. Cookie header: tt_session
  const cookieHeader = req.header('cookie')
  if (cookieHeader) {
    try {
      const cookies = parseCookies(cookieHeader)
      const token = cookies.tt_session
      if (token && /^[a-f0-9]{64}$/i.test(token)) return token
    } catch {
      // Ignore malformed cookies
    }
  }

  return undefined
}

export function requireAuth(authService: AuthService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = extractSessionToken(req)
      if (!token) {
        throw new AppError(401, 'Authentication is required')
      }
      const context = await authService.authenticate(token)
      req.auth = context
      next()
    } catch (error) {
      next(error)
    }
  }
}

export function requireRole(allowed: PrincipalType[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError(401, 'Authentication is required'))
    }

    const { type } = req.auth.principal
    // SUPER_ADMIN has access to all ADMIN capabilities
    const hasRole =
      allowed.includes(type) ||
      (type === 'SUPER_ADMIN' && allowed.includes('ADMIN'))

    if (!hasRole) {
      return next(new AppError(403, 'Forbidden: Insufficient privileges'))
    }

    next()
  }
}
