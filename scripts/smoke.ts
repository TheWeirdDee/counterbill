import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { migrate } from '../src/db/migrate';
import { closePool, query } from '../src/db/pool';
import { createDemoCaseInstance, addDemoEvidence } from '../src/server/demo';
import { startInvestigation } from '../src/server/runs';
import { currentDraft, latestAssessment, listCalculations, listFacts, listFindings, listAgentRuns } from '../src/db/repo';

process.env.COUNTERBILL_INFERENCE ??= 'test';
await migrate();
const c = await createDemoCaseInstance('volume-dispute-aug-2026', 'smoke-token-hash');
console.log('case', c.id);
const { run } = await startInvestigation(c.id);
console.log('run', run.id);
const r = spawnSync(process.execPath, ['--import', 'tsx', 'workers/run-child.ts', run.id], { stdio: 'inherit', env: process.env });
console.log('child exit', r.status);
const dump = async (title: string) => {
  console.log(`\n===== ${title}`);
  const ar = await listAgentRuns(c.id);
  for (const a of ar) console.log(a.agentRole.padEnd(9), a.status.padEnd(10), a.startedAt.slice(11, 23), (a.finishedAt ?? '').slice(11, 23), a.mozaikLoopId?.slice(0, 8), a.resultSummary ?? a.error);
  console.log('facts', (await listFacts(c.id)).map((f) => `${f.ref}:${f.key}=${f.value}`).join(' | '));
  console.log('calcs', (await listCalculations(c.id)).map((k) => `${k.ref}:${k.display}`).join(' | '));
  console.log('findings', (await listFindings(c.id, { includeSuperseded: true })).map((f) => `${f.ref}[${f.status}] ${f.topic}`).join('\n         '));
  const a = await latestAssessment(c.id);
  console.log('assessment', a?.version, a?.classification, '\n  ', a?.headline, '\n  reason:', a?.changeReason);
  const d = await currentDraft(c.id);
  console.log('draft v', d?.version);
};
await dump('after first run');
if (process.argv[2] !== 'first') {
  await addDemoEvidence(c.id, 'survey');
  const queued = await query('select id, status, kind from investigation_runs where case_id = $1 order by queued_at desc limit 1', [c.id]);
  const id = (queued[0] as { id: string }).id;
  const r2 = spawnSync(process.execPath, ['--import', 'tsx', 'workers/run-child.ts', id], { stdio: 'inherit', env: process.env });
  console.log('child2 exit', r2.status);
  await dump('after survey');
}
await closePool();
