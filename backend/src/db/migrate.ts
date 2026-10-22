import { resolve } from 'node:path'
import { readConfig } from '../config'
import { postgresDatabase } from './database'
import { runMigrations } from './migrations'

const config = readConfig()
const db = postgresDatabase(config.MIGRATION_DATABASE_URL || config.DATABASE_URL, 1)
try {
  // Backend npm scripts run with backend/ as their working directory.
  const messages = await runMigrations(db, resolve('migrations'), process.argv.includes('--status'))
  messages.forEach(message => console.log(message))
} catch (error) {
  console.error('Migration failed. Check the connection, permissions, and migration history.',
    error instanceof Error && error.message.startsWith('Applied migration changed:') ? error.message : '')
  process.exitCode = 1
} finally { await db.close() }
