import pg from 'pg'

export interface SqlClient {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>
}

export interface Database extends SqlClient {
  transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export function postgresDatabase(connectionString: string, max = 10): Database {
  // TLS settings come from the URL (Neon supplies sslmode=require).
  const pool = new pg.Pool({ connectionString, max, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 })
  pool.on('error', () => console.error('Idle PostgreSQL connection failed'))
  return {
    async query<Row>(text: string, values?: unknown[]) {
      const result = await pool.query(text, values)
      return { rows: result.rows as Row[] }
    },
    async transaction(work) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SET LOCAL statement_timeout = '15s'")
        const value = await work(client)
        await client.query('COMMIT')
        return value
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally { client.release() }
    },
    close: () => pool.end(),
  }
}
