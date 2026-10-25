import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readConfig } from '../config'
import { postgresDatabase } from './database'
import { runMigrations } from './migrations'

const config = readConfig()
const db = postgresDatabase(config.MIGRATION_DATABASE_URL || config.DATABASE_URL, 1)
try {
  // src/db/migrate.ts and dist/migrate.js have different depths. Resolve beside
  // the module so release commands do not depend on a particular working directory.
  const migrationsDir = ['../migrations/', '../../migrations/']
    .map(relative => fileURLToPath(new URL(relative, import.meta.url))).find(existsSync)
  if (!migrationsDir) throw new Error('Migration files are missing from the application package')
  const messages = await runMigrations(db, migrationsDir, process.argv.includes('--status'))
  messages.forEach(message => console.log(message))
} catch (error) {
  console.error('Migration failed. Check the connection, permissions, and migration history.',
    error instanceof Error && error.message.startsWith('Applied migration changed:') ? error.message : '')
  process.exitCode = 1
} finally { await db.close() }
