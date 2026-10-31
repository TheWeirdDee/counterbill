/**
 * Exercises the LIVE inference path (Mozaik DefaultInferenceRunner → OpenAIResponses endpoint → HTTP) against a local,
 * protocol-faithful fake of the OpenAI Responses API. This is NOT a real model: the fake answers with the scripted
 * outputs. What it proves is that the live code path is wired correctly: request mapping, strict JSON schemas, the
 * tool-calling loop, token accounting, the key staying out of storage, and the run being labelled live (not test mode).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeCase, makeUser, addText, INVOICE, PACKING, runQueued, setupDb, snapshot, teardownDb } from './helpers';
import { latestAssessment, listRuns } from '@/db/repo';
import { query } from '@/db/pool';
import { scriptedAnswer } from '@/mozaik/test-runner';
import { startInvestigation } from '@/server/runs';

interface Seen {
  name: string;
  tools: string[];
  strict: boolean;
  schemaOk: boolean;
  hasDeveloperPolicy: boolean;
  auth: string | undefined;
  hadToolOutput: boolean;
}
const seen: Seen[] = [];
let server: Server;
let baseUrl = '';
let toolCallsIssued = 0;

function strictObject(s: unknown): boolean {
  if (!s || typeof s !== 'object') return true;
  const o = s as Record<string, unknown>;
  if (o.type === 'object' && o.properties) {
    const keys = Object.keys(o.properties as object).sort();
    if (o.additionalProperties !== false || JSON.stringify((o.required as string[] | undefined)?.slice().sort()) !== JSON.stringify(keys)) return false;
  }
  return Object.values(o).every((v) => (Array.isArray(v) ? v.every(strictObject) : strictObject(v)));
}

beforeAll(async () => {
  await setupDb();
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const r = JSON.parse(body) as { model: string; input: { role?: string; type: string; content?: { text: string }[]; output?: { text: string }[] }[]; tools?: { name: string }[]; text?: { format: { name: string; strict: boolean; schema: unknown } } };
      const name = r.text?.format.name ?? '';
      const user = [...r.input].reverse().find((i) => i.role === 'user')?.content?.[0].text ?? '';
      const hadToolOutput = r.input.some((i) => i.type === 'function_call_output');
      seen.push({
        name,
        tools: (r.tools ?? []).map((t) => t.name),
        strict: r.text?.format.strict === true,
        schemaOk: strictObject(r.text?.format.schema),
        hasDeveloperPolicy: r.input.some((i) => i.role === 'developer' && /UNTRUSTED EVIDENCE/.test(i.content?.[0].text ?? '')),
        auth: req.headers.authorization,
        hadToolOutput,
      });
      res.setHeader('content-type', 'application/json');
      const usage = { input_tokens: 1200, output_tokens: 300, total_tokens: 1500 };
      // The Billing Agent first calls a deterministic tool, then answers: exercises Mozaik's function-call loop.
      if (name === 'billing_output' && !hadToolOutput && toolCallsIssued === 0) {
        toolCallsIssued++;
        res.end(JSON.stringify({ id: 'resp_t', output: [{ type: 'function_call', call_id: 'call_1', name: 'calculate_charge', arguments: JSON.stringify({ volumeCbm: '1.10', ratePerCbm: '542000' }) }], usage }));
        return;
      }
      const answer = scriptedAnswer(name, user);
      res.end(JSON.stringify({ id: 'resp_1', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(answer), annotations: [] }] }], usage }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(async () => {
  server?.close();
  await teardownDb();
});

describe('live inference path against a protocol-faithful fake provider', () => {
  it('runs an investigation through DefaultInferenceRunner and is labelled live, with the key kept out of storage', async () => {
    const owner = (await makeUser()).id;
    const c = await makeCase(owner, 'Live path');
    await addText(c.id, 'invoice.txt', INVOICE, 'invoice');
    await addText(c.id, 'packing.txt', PACKING, 'packing_list');

    const saved = { ...process.env };
    delete process.env.COUNTERBILL_INFERENCE;
    process.env.OPENAI_API_KEY = 'sk-fake-key-for-test';
    process.env.MOZAIK_MODEL = 'gpt-5.5';
    let run;
    try {
      run = (await startInvestigation(c.id)).run;
    } finally {
      process.env = saved;
    }
    expect(run.inferenceMode).toBe('live');

    const out = await runQueued(run.id, { COUNTERBILL_INFERENCE: '', OPENAI_API_KEY: 'sk-fake-key-for-test', OPENAI_BASE_URL: baseUrl, MOZAIK_MODEL: 'gpt-5.5' });
    expect(out.output).not.toMatch(/sk-fake-key-for-test/);
    const row = (await listRuns(c.id))[0];
    expect(row.status).toBe('completed');
    expect(row.inferenceMode).toBe('live');
    expect(row.model).toBe('gpt-5.5');
    expect(row.modelCalls).toBeGreaterThanOrEqual(6);

    // every call used provider-side strict structured output with a valid strict schema, and sent the untrusted-data policy
    expect(seen.length).toBeGreaterThanOrEqual(6);
    for (const s of seen) {
      expect(s.strict).toBe(true);
      expect(s.schemaOk).toBe(true);
      expect(s.hasDeveloperPolicy).toBe(true);
      expect(s.auth).toBe('Bearer sk-fake-key-for-test');
    }
    expect(new Set(seen.map((s) => s.name))).toEqual(new Set(['evidence_output', 'billing_output', 'contract_output', 'timeline_output', 'case_output', 'draft_output']));
    // tools were offered to Billing and the tool result was fed back
    expect(seen.find((s) => s.name === 'billing_output')!.tools.sort()).toEqual(['calculate_cbm', 'calculate_charge']);
    expect(seen.some((s) => s.name === 'billing_output' && s.hadToolOutput)).toBe(true);

    const s = await snapshot(c.id);
    expect(s.calcs.find((k) => k.topic === 'billed_vs_declared:charge_difference')!.output).toBe('298100');
    expect((await latestAssessment(c.id))!.classification).toBe('declared_volume_conflicts_with_bill');
    // token usage recorded from the provider response; never the key
    const tokens = s.agentRuns.filter((a) => a.inputTokens);
    expect(tokens.length).toBeGreaterThan(0);
    const stored = await query("select count(*) as n from case_events where payload::text like '%sk-fake%'");
    expect(Number((stored[0] as { n: string }).n)).toBe(0);
    const trace = await query("select payload from case_events where case_id = $1 and type = 'mozaik.function_call.started'", [c.id]);
    expect(JSON.stringify(trace)).toContain('calculate_charge');
  });
});
