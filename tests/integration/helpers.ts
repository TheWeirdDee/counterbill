// Side effects first: point every module at the test database and the labelled test-mode runner.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://counterbill:counterbill@127.0.0.1:54329/counterbill_test';
process.env.COUNTERBILL_INFERENCE = 'test';
process.env.COUNTERBILL_TEST_DELAY_MS = process.env.COUNTERBILL_TEST_DELAY_MS ?? '';
process.env.MAX_AGENT_REVISIONS = '6';

import { spawn } from 'node:child_process';
import path from 'node:path';
import { migrate } from '@/db/migrate';
import { closePool, one, query } from '@/db/pool';
import { camel, createCase, listAgentRuns, listCalculations, listFacts, listFindings, listRuns, type CaseRow, type RunRow } from '@/db/repo';
import { addDocument, parseQueuedDocument } from '@/server/documents';
import { hashPassword } from '@/server/auth';
import type { DocumentKind, SourceClass } from '@/domain/schemas';

export async function setupDb() {
  await migrate();
  await query('truncate users, cases, rate_limits cascade');
}
export async function teardownDb() {
  await closePool();
}

export async function makeUser(email = `u${Math.random().toString(36).slice(2)}@example.test`) {
  const row = await one<{ id: string }>('insert into users(email, password_hash, display_name) values ($1,$2,$3) returning id', [email, await hashPassword('correct horse battery'), 'Test User']);
  return { id: row!.id, email };
}

export async function makeCase(ownerId: string, name = 'Integration case'): Promise<CaseRow> {
  return createCase({ name, claimant: 'Test Importer', counterparty: 'Test Carrier', origin: 'China', destination: 'Lagos', shipmentClass: 'LCL', currency: 'NGN', status: 'draft' }, { ownerId });
}

export async function addText(caseId: string, filename: string, text: string, kind: DocumentKind, sourceClass: SourceClass = 'primary_document') {
  const doc = await addDocument(caseId, { filename, bytes: Buffer.from(text, 'utf8'), kind, sourceClass });
  await parseQueuedDocument(caseId, doc.ref);
  return doc;
}

export const INVOICE = 'FREIGHT INVOICE\nPackages: 6\nBilled volume: 1.10 CBM\nRate: NGN 542,000 per CBM\nFreight charge: NGN 596,200\n';
export const PACKING = 'PACKING LIST\nPackages: 6\nEstimated total volume: 0.55 CBM\n';

/** Claim a queued run exactly like the supervisor does, then host it in a real worker child process. */
export async function runQueued(runId: string, env: Record<string, string | undefined> = {}): Promise<{ code: number | null; output: string }> {
  await query("update investigation_runs set status='running', started_at=now(), worker_id='test', lease_expires_at = now() + interval '60 seconds' where id=$1 and status='queued'", [runId]);
  return spawnChild(runId, env);
}

export function spawnChild(runId: string, env: Record<string, string | undefined> = {}): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('workers/run-child.ts'), runId], {
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('exit', (code) => resolve({ code, output }));
  });
}

export async function latestRun(caseId: string): Promise<RunRow> {
  const runs = await listRuns(caseId);
  return runs[0];
}

export async function snapshot(caseId: string) {
  const [facts, calcs, findings, agentRuns, runs] = await Promise.all([listFacts(caseId, { includeInactive: true }), listCalculations(caseId, { all: true }), listFindings(caseId, { includeSuperseded: true }), listAgentRuns(caseId), listRuns(caseId)]);
  return { facts, calcs, findings, agentRuns, runs };
}

export async function events(caseId: string, runId?: string) {
  const rows = await query('select * from case_events where case_id = $1 and ($2::uuid is null or run_id = $2) order by seq', [caseId, runId ?? null]);
  return rows.map((r) => camel<{ seq: string; type: string; producer: string; payload: Record<string, unknown>; occurredAt: string; causationId: string | null; runId: string | null }>(r));
}

export const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

export function letterText(draft: { sections: unknown }): string {
  return (draft.sections as { text: string }[]).map((s) => s.text).join('\n');
}
