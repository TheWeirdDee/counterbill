/**
 * Starts a local embedded PostgreSQL (no Docker needed) and keeps running until Ctrl+C.
 * Data lives in .data/pg. For production use a managed PostgreSQL and set DATABASE_URL instead.
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.EMBEDDED_PG_PORT ?? 54329);
const dir = path.resolve(process.env.EMBEDDED_PG_DIR ?? '.data/pg');
const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'counterbill',
  password: 'counterbill',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: (e: unknown) => console.error('[postgres]', e),
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  await pg.createDatabase('counterbill');
  await pg.createDatabase('counterbill_test');
}
console.log(`Embedded PostgreSQL ready: postgres://counterbill:counterbill@127.0.0.1:${port}/counterbill`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
