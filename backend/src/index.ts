import { readConfig } from './config'
import { postgresDatabase } from './db/database'
import { createApplication } from './app'
import { configureTestingAccounts } from './modules/auth/testingAccounts'
import { createTelemetry } from './telemetry'

const config = readConfig()
const db = postgresDatabase(config.DATABASE_URL, config.DATABASE_POOL_MAX)
let demoAccounts: Awaited<ReturnType<typeof configureTestingAccounts>>
try {
  await db.query('SELECT actor_name, actor_email FROM audit_logs LIMIT 0')
  await db.query('SELECT deleted_at FROM games LIMIT 0')
  demoAccounts = await configureTestingAccounts(db, config.TEST_ACCOUNTS_ENABLED)
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : 'unknown'
  const guidance = ['42703', '42P01'].includes(code)
    ? 'Database schema is out of date. Run npm run db:migrate before starting development (production: npm run db:migrate:prod).'
    : code === '23505'
      ? 'A reserved testing account ID conflicts with an existing account.'
      : 'Check database connectivity, migrations, and reserved testing account IDs.'
  console.error(`API startup checks failed (${code}). ${guidance}`)
  await db.close()
  process.exit(1)
}
const telemetry = createTelemetry({ projectKey: config.POSTHOG_PROJECT_KEY, host: config.POSTHOG_HOST, environment: config.NODE_ENV })
const { server, io } = createApplication(db, {
  telemetry,
  origins: config.origins,
  trustProxyHops: config.TRUST_PROXY_HOPS,
  bootstrapSecret: config.SUPER_ADMIN_BOOTSTRAP_SECRET,
  demoAccounts,
  email: { url: config.EMAIL_API_URL, apiKey: config.EMAIL_API_KEY, from: config.EMAIL_FROM },
})

try {
  await db.query('SELECT id FROM games LIMIT 0')
  server.listen(config.PORT, config.HOST, () => console.log(`Tambola API listening on port ${config.PORT}`))
} catch {
  console.error('Database is unavailable or migrations are missing. Check DATABASE_URL and run npm run db:migrate.')
  await db.close()
  process.exit(1)
}

let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  const deadline = setTimeout(() => process.exit(1), 10_000).unref()
  io.disconnectSockets(true)
  await new Promise<void>(resolve => io.close(() => resolve()))
  await db.close()
  await telemetry?.shutdown()
  clearTimeout(deadline)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
