import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { readConfig } from '../config'
import { postgresDatabase } from './database'
import { runMigrations } from './migrations'

const config = readConfig()
const db = postgresDatabase(config.MIGRATION_DATABASE_URL || config.DATABASE_URL, 1)
try {
  // Support running either from repo root or backend/ directory.
  const migrationsDir = existsSync(resolve('migrations')) ? resolve('migrations') : resolve('backend/migrations')
  const messages = await runMigrations(db, migrationsDir, process.argv.includes('--status'))
  messages.forEach(message => console.log(message))
} catch (error) {
  console.error('Migration failed. Check the connection, permissions, and migration history.',
    error instanceof Error && error.message.startsWith('Applied migration changed:') ? error.message : '')
  process.exitCode = 1
} finally { await db.close() }
