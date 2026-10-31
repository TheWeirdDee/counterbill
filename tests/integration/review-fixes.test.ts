/**
 * Regression tests for five gaps found in code review: interrupted parsing, replaced documents, cancellation status,
 * concurrent upload quotas and the evidence revision captured by a reassessment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addText, INVOICE, latestRun, makeCase, makeUser, PACKING, runQueued, setupDb, snapshot, teardownDb } from './helpers';
import { one, pool, query } from '@/db/pool';
import { bumpRevision, getCase, getDocument } from '@/db/repo';
import { UploadRejected } from '@/docs/parse';
import { evidenceMessage } from '@/mozaik/prompts';
import { config } from '@/server/config';
import { addDocument, parsePendingDocuments, parseQueuedDocument } from '@/server/documents';
import { cancelActiveRun, requestReassess, startInvestigation } from '@/server/runs';

let owner = '';
beforeAll(async () => {
  await setupDb();
  owner = (await makeUser()).id;
});
afterAll(teardownDb);

async function investigated() {
  const c = await makeCase(owner, `Case ${Math.random().toString(36).slice(2, 7)}`);
  await addText(c.id, 'invoice.txt', INVOICE, 'invoice');
  await addText(c.id, 'packing.txt', PACKING, 'packing_list');
  const { run } = await startInvestigation(c.id);
  const r = await runQueued(run.id);
  expect(r.code).toBe(0);
  return c;
}

describe('interrupted parsing is recovered', () => {
  it('a document left "parsing" by a stopped worker is requeued once its lease expires, then parsed', async () => {
    const c = await makeCase(owner);
    const d = await addDocument(c.id, { filename: 'invoice.txt', bytes: Buffer.from(INVOICE), kind: 'invoice' });
    // what a worker killed mid-parse leaves behind
    await query("update documents set parse_status = 'parsing', parse_attempts = 1, parse_lease_expires_at = now() - interval '1 second' where case_id = $1 and ref = $2", [c.id, d.ref]);
    await parsePendingDocuments(50);
    expect((await getDocument(c.id, d.ref))!.parseStatus).toBe('ready');
  });

  it('a claim whose lease has not expired is left alone', async () => {
    const c = await makeCase(owner);
    const d = await addDocument(c.id, { filename: 'invoice.txt', bytes: Buffer.from(INVOICE), kind: 'invoice' });
    await query("update documents set parse_status = 'parsing', parse_attempts = 1, parse_lease_expires_at = now() + interval '5 minutes' where case_id = $1 and ref = $2", [c.id, d.ref]);
    await parsePendingDocuments(50);
    expect((await getDocument(c.id, d.ref))!.parseStatus).toBe('parsing');
  });

  it('a document that keeps interrupting the parser fails with a reason instead of blocking the case forever', async () => {
    const c = await makeCase(owner);
    const d = await addDocument(c.id, { filename: 'invoice.txt', bytes: Buffer.from(INVOICE), kind: 'invoice' });
    await query("update documents set parse_status = 'parsing', parse_attempts = 3, parse_lease_expires_at = now() - interval '1 second' where case_id = $1 and ref = $2", [c.id, d.ref]);
    await parsePendingDocuments(50);
    const doc = (await getDocument(c.id, d.ref))!;
    expect(doc.parseStatus).toBe('failed');
    expect(doc.parseError).toMatch(/interrupted repeatedly/);
  });
});

describe('a replaced document leaves the evidence', () => {
  it('supersedes the old document and its facts, and no agent prompt contains it any more', async () => {
    const c = await investigated();
    const before = await snapshot(c.id);
    const fromInvoice = before.facts.filter((f) => f.status === 'active' && f.spanRefs.length && f.spanRefs.every((s) => s.startsWith('D1-')));
    expect(fromInvoice.length).toBeGreaterThan(0);

    const corrected = INVOICE.replace('Billed volume: 1.10 CBM', 'Billed volume: 1.00 CBM');
    const repl = await addDocument(c.id, { filename: 'invoice-corrected.txt', bytes: Buffer.from(corrected), kind: 'invoice', supersedesRef: 'D1' });
    await parseQueuedDocument(c.id, repl.ref);

    expect((await getDocument(c.id, 'D1'))!.supersededByRef).toBe(repl.ref);
    const after = await snapshot(c.id);
    for (const f of fromInvoice) {
      const now = after.facts.find((x) => x.ref === f.ref)!;
      expect(now.status).toBe('superseded');
      expect(now.notes).toMatch(/Document replaced: D1 was replaced by/);
    }
    const prompt = await evidenceMessage(c.id, null, null);
    expect(prompt).toContain('Billed volume: 1.00 CBM');
    expect(prompt).not.toContain('Billed volume: 1.10 CBM');
    expect(prompt).not.toMatch(/D1-p\d+-s\d+/);
  });
});

describe('cancelling does not leave the case "Investigating"', () => {
  it('a cancelled queued start returns a never-run case to not started', async () => {
    const c = await makeCase(owner);
    await addText(c.id, 'invoice.txt', INVOICE, 'invoice');
    await startInvestigation(c.id);
    expect((await getCase(c.id))!.status).toBe('processing');
    expect(await cancelActiveRun(c.id)).toBe(true);
    expect((await getCase(c.id))!.status).toBe('draft');
  });

  it('a cancelled reassessment returns the case to its latest assessment readiness', async () => {
    const c = await investigated();
    const settled = (await getCase(c.id))!.status;
    expect(['review_ready', 'needs_input']).toContain(settled);
    const run = await requestReassess(c.id, { reason: 'test' });
    expect(run?.status).toBe('queued');
    expect((await getCase(c.id))!.status).toBe('processing');
    await cancelActiveRun(c.id);
    const assessment = await one<{ readiness: string }>('select readiness from assessments where case_id = $1 order by version desc limit 1', [c.id]);
    expect((await getCase(c.id))!.status).toBe(assessment!.readiness);
    expect((await latestRun(c.id)).status).toBe('cancelled');
  });
});

describe('concurrent uploads cannot exceed the case limits', () => {
  it('simultaneous uploads stop exactly at the document limit', async () => {
    const c = await makeCase(owner);
    const limit = config.maxCaseDocuments;
    const results = await Promise.allSettled(
      Array.from({ length: limit + 6 }, (_, i) => addDocument(c.id, { filename: `note-${i}.txt`, bytes: Buffer.from(`Note ${i}\nSome text.\n`), kind: 'other' })),
    );
    const accepted = results.filter((r) => r.status === 'fulfilled').length;
    const refused = results.filter((r) => r.status === 'rejected');
    const stored = await one<{ n: string }>('select count(*) as n from documents where case_id = $1', [c.id]);
    expect(Number(stored!.n)).toBe(limit);
    expect(accepted).toBe(limit);
    expect(refused.length).toBe(6);
    for (const r of refused) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(UploadRejected);
  });
});

describe('a reassessment records the revision current when it holds the lock', () => {
  it('waiting on a concurrent evidence change does not capture the older revision', async () => {
    const c = await investigated();
    const client = await pool().connect();
    let queued;
    try {
      await client.query('begin');
      await client.query('select 1 from cases where id = $1 for update', [c.id]);
      const newRevision = await bumpRevision(client, c.id);
      const pending = requestReassess(c.id, { reason: 'evidence changed meanwhile' }); // blocks on the row lock
      await new Promise((r) => setTimeout(r, 400));
      await client.query('commit');
      queued = await pending;
      expect(queued!.evidenceRevision).toBe(newRevision);
    } finally {
      client.release();
    }
  });
});
