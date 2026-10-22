import { PGlite } from '@electric-sql/pglite'
import type { Database, SqlClient } from '../src/db/database'

/** Real PostgreSQL in WASM, used only in tests; production always uses pg. */
export async function testDatabase(): Promise<Database> {
  const pg = new PGlite()
  await pg.waitReady
  const adapt = (client: Pick<PGlite, 'query' | 'exec'>): SqlClient => ({
    async query<Row>(text: string, values?: unknown[]) {
      if (!values?.length) {
        const results = await client.exec(text)
        return { rows: (results.at(-1)?.rows ?? []) as Row[] }
      }
      const result = await client.query<Row>(text, values)
      return { rows: result.rows }
    },
  })
  return {
    ...adapt(pg),
    transaction: work => pg.transaction(tx => work(adapt(tx))),
    close: () => pg.close(),
  }
}
