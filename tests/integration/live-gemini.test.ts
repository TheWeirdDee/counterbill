/**
 * OPT-IN live checks against the real Gemini API (RUN_LIVE_GEMINI=1, key in .env). They cost nothing on the free tier
 * and are skipped otherwise, so the normal suite never makes a network call to a model provider.
 *
 * What this proves with a REAL provider response: when a model has no free-tier quota for the key, Counterbill
 * stops promptly with a clear typed error, makes only a bounded number of calls, records the failure honestly, and
 * never falls back to another model or to canned output.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addText, events, INVOICE, makeCase, makeUser, PACKING, runQueued, setupDb, snapshot, teardownDb } from './helpers';
import { listRuns } from '@/db/repo';
import { startInvestigation } from '@/server/runs';

const LIVE = process.env.RUN_LIVE_GEMINI === '1';
// The Pro model in Mozaik 4.2.0's Gemini list had no free-tier quota for the author's key (HTTP 429, retryDelay about a day).
const NO_FREE_TIER_MODEL = process.env.GEMINI_NO_FREE_TIER_MODEL ?? 'gemini-3.1-pro-preview';

beforeAll(async () => {
  if (LIVE) await setupDb();
});
afterAll(async () => {
  if (LIVE) await teardownDb();
});

describe.skipIf(!LIVE)('real Gemini API: exhausted free-tier quota', () => {
  it('fails clearly and boundedly, with no model fallback', async () => {
    const owner = (await makeUser()).id;
    const c = await makeCase(owner, 'Quota check');
    await addText(c.id, 'invoice.txt', INVOICE, 'invoice');
    await addText(c.id, 'packing.txt', PACKING, 'packing_list');

    const saved = { ...process.env };
    delete process.env.COUNTERBILL_INFERENCE;
    process.env.MOZAIK_MODEL = NO_FREE_TIER_MODEL;
    let runId = '';
    try {
      runId = (await startInvestigation(c.id)).run.id;
    } finally {
      process.env = saved;
    }
    const t0 = Date.now();
    const out = await runQueued(runId, { COUNTERBILL_INFERENCE: '', MOZAIK_MODEL: NO_FREE_TIER_MODEL });
    const seconds = (Date.now() - t0) / 1000;
    expect(out.code).toBe(0);
    expect(out.output).not.toMatch(/AIza|AQ\./); // the key is never printed

    const run = (await listRuns(c.id))[0];
    expect(['failed', 'partial']).toContain(run.status);
    expect(run.model).toBe(NO_FREE_TIER_MODEL); // still the model that was asked for
    expect(run.modelCalls).toBeLessThanOrEqual(8); // bounded: no retry storm
    expect(seconds).toBeLessThan(90); // a day-long retryDelay is reported, not slept

    const s = await snapshot(c.id);
    expect(s.agentRuns.length).toBeGreaterThan(0);
    for (const a of s.agentRuns) {
      expect(a.status).toBe('failed');
      expect(a.error).toMatch(/provider_quota_exhausted|provider_rate_limited/);
    }
    expect(s.agentRuns.some((a) => /will not switch models/.test(a.error ?? ''))).toBe(true);
    expect(s.facts).toHaveLength(0); // nothing invented
    const ev = await events(c.id, runId);
    expect(ev.filter((e) => e.type === 'agent.failed').length).toBeGreaterThan(0);
    expect(JSON.stringify(ev)).not.toMatch(/flash-lite|flash/); // no silent substitution of a cheaper model
  });
});
