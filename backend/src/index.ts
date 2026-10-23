import { readConfig } from './config'
import { postgresDatabase } from './db/database'
import { createApplication } from './app'
import { recoverInterruptedRounds } from './modules/recovery/service'

const config = readConfig()
const db = postgresDatabase(config.DATABASE_URL, config.DATABASE_POOL_MAX)
const { server, io } = createApplication(db, {
  origins: config.origins,
  trustProxyHops: config.TRUST_PROXY_HOPS,
  bootstrapSecret: config.SUPER_ADMIN_BOOTSTRAP_SECRET,
  email: { url: config.EMAIL_API_URL, apiKey: config.EMAIL_API_KEY, from: config.EMAIL_FROM },
})

try {
  await db.query('SELECT id FROM games LIMIT 0')
  const recovered = await recoverInterruptedRounds(db)
  if (recovered.length) console.warn('Interrupted rounds require Super Admin recovery', { count: recovered.length })
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
  clearTimeout(deadline)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
