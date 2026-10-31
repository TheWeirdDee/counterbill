import pg from 'pg';
import { config } from '@/server/config';

// pg returns int8/numeric as strings by default; keep that so no value silently loses precision.
type Q = pg.Pool | pg.PoolClient;

const g = globalThis as unknown as { __cbPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!g.__cbPool) {
    g.__cbPool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    g.__cbPool.on('error', (err) => console.error('[db] idle client error', err.message));
  }
  return g.__cbPool;
}

export async function closePool(): Promise<void> {
  if (g.__cbPool) {
    const p = g.__cbPool;
    g.__cbPool = undefined;
    await p.end();
  }
}

export type Db = Q;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = [], db: Db = pool()): Promise<T[]> {
  const res = await db.query<T>(sql, params as never[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = [], db: Db = pool()): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

/** Run `fn` in a transaction. Retries serialization/deadlock failures a few times. */
export async function tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool().connect();
    try {
      await client.query('begin');
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      const code = (err as { code?: string }).code;
      if ((code === '40001' || code === '40P01') && attempt < 3) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}
