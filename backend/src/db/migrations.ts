import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database } from './database'

export async function runMigrations(db: Database, directory: string, statusOnly = false): Promise<string[]> {
  return db.transaction(async client => {
    // Transaction advisory locks also work through a transaction pooler.
    await client.query('SELECT pg_advisory_xact_lock(734291864)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')
    const applied = new Map(rows.map(row => [row.name, row.checksum]))
    const files = (await readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort()
    const messages: string[] = []
    for (const file of files) {
      const sql = (await readFile(join(directory, file), 'utf8')).replace(/\r\n/g, '\n')
      const checksum = createHash('sha256').update(sql).digest('hex')
      if (applied.has(file) && applied.get(file) !== checksum) throw new Error(`Applied migration changed: ${file}`)
      messages.push(`${applied.has(file) ? 'applied' : statusOnly ? 'pending' : 'applied'} ${file}`)
      if (applied.has(file) || statusOnly) continue
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)', [file, checksum])
    }
    return messages
  })
}
