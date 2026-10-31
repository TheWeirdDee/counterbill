/**
 * Hosts ONE investigation run. Spawned by workers/supervisor.ts as its own process so that the Mozaik runtime
 * (initialised once per process) and its RuntimeState are isolated to one case and one run.
 */
import path from 'node:path';
import os from 'node:os';

// Privacy: never let Mozaik Cloud telemetry pick up credentials and forward case content.
delete process.env.MOZAIK_API_KEY;
delete process.env.MOZAIK_PROJECT_KEY;
process.env.MOZAIK_CREDENTIALS_FILE = path.join(os.tmpdir(), 'counterbill-no-mozaik-credentials.json');

import 'dotenv/config';
delete process.env.MOZAIK_API_KEY;
delete process.env.MOZAIK_PROJECT_KEY;

// Mozaik's runLoop is fire-and-forget; a failed model call surfaces as an unhandled rejection after our runner
// wrapper has already reported it to the owning task. Log a short note instead of crashing the whole run.
process.on('unhandledRejection', (reason) => {
  console.error('[run-child] model loop ended with an error:', (reason as Error)?.message?.slice(0, 200) ?? String(reason));
});
process.on('warning', () => {});

const runId = process.argv[2];
if (!runId) {
  console.error('usage: run-child <runId>');
  process.exit(2);
}

const { runInvestigation } = await import('../src/mozaik/orchestrator');
const { query, closePool } = await import('../src/db/pool');

let code = 0;
try {
  const outcome = await runInvestigation(runId);
  await query(
    `update investigation_runs set status = $2, finished_at = now(), error_code = $3, error_message = $4, lease_expires_at = null where id = $1`,
    [runId, outcome.status, outcome.errorCode ?? null, outcome.errorMessage ?? null],
  );
  const caseId = (await query<{ case_id: string }>('select case_id from investigation_runs where id = $1', [runId]))[0]?.case_id;
  if (caseId && outcome.status === 'failed') {
    await query("update cases set status = 'failed', updated_at = now() where id = $1", [caseId]);
  } else if (caseId && outcome.status === 'cancelled') {
    // Do not leave the case saying "Investigating" after the run stopped.
    const { settleCaseStatus } = await import('../src/server/runs');
    await settleCaseStatus(caseId);
  }
} catch (err) {
  code = 1;
  const message = (err as Error).message ?? String(err);
  console.error('[run-child] run failed:', message);
  await query(`update investigation_runs set status = 'failed', finished_at = now(), error_code = 'worker_error', error_message = $2, lease_expires_at = null where id = $1 and status = 'running'`, [runId, message.slice(0, 500)]).catch(() => {});
  await query(`update cases set status = 'failed', updated_at = now() where id = (select case_id from investigation_runs where id = $1)`, [runId]).catch(() => {});
}
await closePool().catch(() => {});
process.exit(code);
