/**
 * Entry point for a single-container host (Render Web Service). One process tree:
 *   1. apply database migrations (retrying while a hosted database wakes up) and stop if they cannot be applied,
 *   2. then start `next start` on the host's PORT, bound to every interface, and the investigation worker supervisor.
 * If either child exits, the other is stopped and this process exits non-zero so the host restarts the container.
 * On SIGTERM (a deploy, or a free instance going to sleep) both children are signalled and given time to finish; the
 * supervisor marks any run it was executing as interrupted so the person can retry from the partial results.
 * It prints variable NAMES that are missing, never their values.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = process.env.PORT || '3000';
const log = (m) => console.log(`[start] ${m}`);

const missing = ['DATABASE_URL', 'PUBLIC_APP_URL'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[start] missing required environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.COUNTERBILL_INFERENCE) {
  console.error('[start] COUNTERBILL_INFERENCE is set. It is for tests only and must be unset on a deployment.');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY && !process.env.gemini_api_key && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  log('warning: no model credential is set, so investigations will report a setup error until one is added');
}

function run(args, name) {
  return spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'], env: process.env }).on('error', (e) => console.error(`[${name}] ${e.message}`));
}
const exited = (child) => new Promise((resolve) => child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))));

let migrated = false;
for (let attempt = 1; attempt <= 4 && !migrated; attempt++) {
  const code = await exited(run(['--import', 'tsx', 'scripts/migrate.ts'], 'migrate'));
  if (code === 0) migrated = true;
  else {
    log(`migration attempt ${attempt} failed (exit ${code})${attempt < 4 ? ', retrying in 5 s' : ''}`);
    if (attempt < 4) await sleep(5000);
  }
}
if (!migrated) {
  console.error('[start] migrations could not be applied; not starting. Check DATABASE_URL and that the database is reachable.');
  process.exit(1);
}

const web = run(['node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', PORT], 'web');
const worker = run(['--import', 'tsx', 'workers/supervisor.ts'], 'worker');
log(`web on 0.0.0.0:${PORT}, worker supervisor started`);

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const c of [web, worker]) c.kill('SIGTERM');
  await Promise.race([Promise.all([exited(web), exited(worker)]), sleep(20000)]);
  for (const c of [web, worker]) c.kill('SIGKILL');
  process.exit(code);
}
process.on('SIGTERM', () => void stop(0));
process.on('SIGINT', () => void stop(0));
web.on('exit', (c) => !stopping && (console.error(`[start] web exited (${c})`), void stop(1)));
worker.on('exit', (c) => !stopping && (console.error(`[start] worker exited (${c})`), void stop(1)));
