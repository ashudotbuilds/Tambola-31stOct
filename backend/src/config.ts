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
  SUPER_ADMIN_BOOTSTRAP_SECRET: z.string().min(32).optional(),
  // Role shortcuts remain enabled during the current testing stage.
  TEST_ACCOUNTS_ENABLED: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
  EMAIL_API_URL: z.string().url().optional(),
  EMAIL_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().email().optional(),
})

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env)
  if (!result.success) {
    // Report field names only: validation errors must not echo connection strings.
    throw new Error(`Invalid environment: ${result.error.issues.map(i => i.path.join('.')).join(', ')}. See backend/.env.example.`)
  }
  const origins = result.data.WEB_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  if (!origins.length || origins.some(origin => {
    try { return new URL(origin).origin !== origin } catch { return true }
  })) throw new Error('WEB_ORIGINS must contain exact URL origins without trailing slashes')
  const emailValues = [result.data.EMAIL_API_URL, result.data.EMAIL_API_KEY, result.data.EMAIL_FROM]
  if (emailValues.some(Boolean) && !emailValues.every(Boolean)) throw new Error('EMAIL_API_URL, EMAIL_API_KEY, and EMAIL_FROM must be set together')
  return { ...result.data, origins }
}

export type Config = ReturnType<typeof readConfig>
