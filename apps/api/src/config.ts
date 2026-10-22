import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Works both from src/ in development and dist/ in production.
loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true } as Parameters<typeof loadEnv>[0])

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  MIGRATION_DATABASE_URL: z.string().optional(),
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),
  WEB_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(50).default(10),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
})

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env)
  if (!result.success) {
    // Report field names only: validation errors must not echo connection strings.
    throw new Error(`Invalid environment: ${result.error.issues.map(i => i.path.join('.')).join(', ')}. See apps/api/.env.example.`)
  }
  const origins = result.data.WEB_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  if (!origins.length || origins.some(origin => {
    try { return new URL(origin).origin !== origin } catch { return true }
  })) throw new Error('WEB_ORIGINS must contain exact URL origins without trailing slashes')
  return { ...result.data, origins }
}

export type Config = ReturnType<typeof readConfig>
