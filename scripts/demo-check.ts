/**
 * Local readiness check. It never calls a model and never pretends to be a live run: it only reports whether this
 * machine could run an investigation, and in which mode.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from '../src/db/migrate';
import { closePool, one } from '../src/db/pool';
import { inferenceReadiness, requiredProviderKey, config } from '../src/server/config';
import { DEMO_CASES } from '../src/server/demo';

let failed = false;
const line = (ok: boolean | null, label: string, detail = '') => {
  if (ok === false) failed = true;
  console.log(`${ok === null ? '[info]' : ok ? '[ ok ]' : '[FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
};

try {
  await migrate();
  const row = await one<{ n: string }>('select count(*) as n from schema_migrations');
  line(true, 'Database reachable and migrated', `${row?.n} migration(s) applied`);
} catch (e) {
  line(false, 'Database', `${(e as Error).message}. Run \`pnpm db:start\` (or docker compose up -d postgres), then \`pnpm db:migrate\`.`);
}

for (const d of DEMO_CASES) {
  const missing = [...d.initial.map((x) => x.file), d.concernFile, ...d.steps.map((s) => s.doc.file)].filter((f) => !fs.existsSync(path.resolve('fixtures', d.folder, f)));
  line(missing.length === 0, `Sample fixtures: ${d.slug}`, missing.length ? `missing ${missing.join(', ')}` : 'present and labelled');
}

const r = inferenceReadiness();
if (r.ready && r.mode === 'live') line(true, 'Live inference configured', `model ${r.model}; credential present (value not shown)`);
else if (r.ready) line(null, 'TEST MODE is on', 'investigations use a deterministic stand-in, not a language model');
else {
  const need = requiredProviderKey(config.model);
  line(false, 'Live inference NOT configured', r.message);
  if (need) console.log(`       To enable: put ${need.env}=... in .env, restart \`pnpm dev\` (the worker reads it at start).`);
}
console.log(failed ? '\nNot ready for a live investigation.' : '\nReady.');
await closePool();
process.exit(failed ? 1 : 0);
