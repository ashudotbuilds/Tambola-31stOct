/** Disposable local server for browser verification. Never used in deployment. */
import { fileURLToPath } from 'node:url'
import { createApplication } from '../src/app'
import { runMigrations } from '../src/db/migrations'
import { testDatabase } from './helpers'

const db = await testDatabase()
await runMigrations(db, fileURLToPath(new URL('../migrations/', import.meta.url)))
const { server, io } = createApplication(db, { origins: ['http://localhost:5173', 'http://127.0.0.1:5173'] })
server.listen(3001, '127.0.0.1', () => console.log('Disposable browser test API: http://127.0.0.1:3001'))
process.on('SIGINT', () => io.close(() => { void db.close() }))
