import { z } from 'zod'

export const bootstrapBody = z.object({
  email: z.string().trim().email('A valid email address is required').max(255),
  name: z.string().trim().min(1, 'Name is required').max(100),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
})

export const loginBody = z.object({
  email: z.string().trim().min(1, 'User ID or email is required').max(255),
  password: z.string().min(1, 'Password is required').max(128),
})

export const createAdminBody = z.object({
  email: z.string().trim().email('A valid email address is required').max(255),
  name: z.string().trim().min(1, 'Name is required').max(100),
  role: z.enum(['ADMIN', 'SUPER_ADMIN']).default('ADMIN'),
})

export const uuid = z.string().uuid('Invalid UUID')
