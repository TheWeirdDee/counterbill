import fs from 'node:fs';
import path from 'node:path';
import { pool } from './pool';

export async function migrate(log: (m: string) => void = () => {}): Promise<string[]> {
  const dir = path.resolve('db/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool().connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock(727001)');
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name as string));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations(name) values ($1) on conflict do nothing', [f]);
        await client.query('commit');
        applied.push(f);
        log(`applied ${f}`);
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
  return applied;
}
