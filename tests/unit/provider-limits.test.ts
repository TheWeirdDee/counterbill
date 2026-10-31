import { describe, expect, it } from 'vitest';
import type { InferenceInput, InferenceOutput, InferenceRunner } from '@mozaik-ai/core';
import { ModelContext, supportedModels } from '@mozaik-ai/core';
import { BudgetExceeded, InstrumentedRunner, ProviderError, classifyProviderError, retryDelayMs } from '@/mozaik/instrumented-runner';
import { toGeminiSchema, providerJsonSchema } from '@/mozaik/schema';
import { allowedClassifications } from '@/domain/case-rules';
import { CaseOutput } from '@/domain/schemas';
import { MOZAIK_MODELS } from '@/server/config';

/** The shape the Gemini API (via @google/genai) really returns for a quota error. */
const gemini429 = (retry: string, extra = '') =>
  Object.assign(new Error(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: `You exceeded your current quota. ${extra}`, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry }] } })), { status: 429 });

const input = (): InferenceInput => ({ model: 'gemini-3.5-flash-lite', context: ModelContext.create() });
const okOutput: InferenceOutput = { items: [], tokenUsage: undefined, rowResponse: null };

function runnerWith(inner: InferenceRunner, policy: Partial<ConstructorParameters<typeof InstrumentedRunner>[4]> = {}) {
  const waits: number[] = [];
  const retries: { attempt: number; waitMs: number; code: string }[] = [];
  const hooks = {
    onStart() {},
    onFinish() {},
    onError() {},
    onRetry: (_: string, info: { attempt: number; waitMs: number; code: string }) => retries.push(info),
  };
  const r = new InstrumentedRunner(inner, 50, hooks, () => {}, { maxRetries: 3, maxWaitMs: 60_000, requestsPerMinute: 0, sleep: async (ms) => void waits.push(ms), ...policy });
  return { r, waits, retries };
}

describe('provider error handling (free-tier limits)', () => {
  it('reads Gemini retry delays', () => {
    expect(retryDelayMs(gemini429('12.3s'))).toBe(12_300);
    expect(retryDelayMs(new Error('Please retry in 8.5s.'))).toBe(8_500);
    expect(retryDelayMs(new Error('boom'))).toBeNull();
  });

  it('retries a short rate limit after the delay the provider asked for, then succeeds, and reports each wait', async () => {
    let n = 0;
    const { r, waits, retries } = runnerWith({ run: async () => (++n < 3 ? Promise.reject(gemini429('7s')) : okOutput), stream: async function* () {} });
    await expect(r.run(input())).resolves.toBe(okOutput);
    expect(n).toBe(3);
    expect(waits).toEqual([7_500, 7_500]); // 7 s + 0.5 s margin, twice
    expect(retries.map((x) => x.attempt)).toEqual([1, 2]);
    expect(retries[0].code).toBe('provider_rate_limited');
  });

  it('is bounded: gives up after the configured number of retries with a typed, readable error', async () => {
    let n = 0;
    const { r } = runnerWith({ run: async () => (n++, Promise.reject(gemini429('2s'))), stream: async function* () {} }, { maxRetries: 2 });
    await expect(r.run(input())).rejects.toMatchObject({ name: 'ProviderError', code: 'provider_rate_limited' });
    expect(n).toBe(3); // first try + 2 retries, never more
  });

  it('does not hold a run for a long wait: a day-long retryDelay is a quota error, reported at once', async () => {
    let n = 0;
    const { r, waits } = runnerWith({ run: async () => (n++, Promise.reject(gemini429('77942s'))), stream: async function* () {} });
    const err = await r.run(input()).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe('provider_quota_exhausted');
    expect(err.message).toMatch(/will not switch models/);
    expect(n).toBe(1);
    expect(waits).toEqual([]);
  });

  it('a medium wait above the cap is also reported rather than slept', async () => {
    const { r, waits } = runnerWith({ run: async () => Promise.reject(gemini429('300s')), stream: async function* () {} }, { maxWaitMs: 60_000 });
    await expect(r.run(input())).rejects.toMatchObject({ code: 'provider_quota_exhausted' });
    expect(waits).toEqual([]);
  });

  it('retries transient outages with backoff and never retries a rejected key or a missing model', async () => {
    let n = 0;
    const t = runnerWith({ run: async () => (++n < 2 ? Promise.reject(Object.assign(new Error('The model is overloaded'), { status: 503 })) : okOutput), stream: async function* () {} });
    await expect(t.r.run(input())).resolves.toBe(okOutput);
    expect(t.waits).toEqual([2000]);

    for (const [status, code] of [[401, 'provider_auth'], [403, 'provider_auth'], [404, 'provider_model_unavailable']] as const) {
      let calls = 0;
      const { r } = runnerWith({ run: async () => (calls++, Promise.reject(Object.assign(new Error('nope'), { status }))), stream: async function* () {} });
      await expect(r.run(input())).rejects.toMatchObject({ code });
      expect(calls).toBe(1);
    }
  });

  it('classifies an invalid Gemini key from its message even without a status', () => {
    const e = classifyProviderError(new Error('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'), 'gemini-3.5-flash-lite');
    expect(e?.code).toBe('provider_auth');
    expect(e?.message).not.toMatch(/AIza/);
  });

  it('paces calls to the configured requests per minute without refusing them', async () => {
    let clock = 1_000_000;
    const realNow = Date.now;
    Date.now = () => clock;
    try {
      const waits: number[] = [];
      const { r } = runnerWith({ run: async () => okOutput, stream: async function* () {} }, { requestsPerMinute: 2, sleep: async (ms) => void (waits.push(ms), (clock += ms)) });
      await Promise.all([r.run(input()), r.run(input()), r.run(input())]);
      expect(r.calls).toBe(3); // nothing is refused or dropped
      expect(waits).toHaveLength(1); // only the third call waited, for the rest of the one-minute window
      expect(waits[0]).toBeGreaterThanOrEqual(59_000);
    } finally {
      Date.now = realNow;
    }
  });

  it('still enforces the per-run call budget', async () => {
    const hooks = { onStart() {}, onFinish() {}, onError() {} };
    const r = new InstrumentedRunner({ run: async () => okOutput, stream: async function* () {} }, 1, hooks);
    await r.run(input());
    await expect(r.run(input())).rejects.toBeInstanceOf(BudgetExceeded);
  });
});

describe('Gemini configuration', () => {
  it('the model list in config matches the installed Mozaik exactly', () => {
    const installed = (provider: string) => supportedModels.filter((m) => m.specification.provider === provider).map((m) => m.specification.name).sort();
    expect([...MOZAIK_MODELS.google].sort()).toEqual(installed('google'));
    expect([...MOZAIK_MODELS.openai].sort()).toEqual(installed('openai'));
    expect([...MOZAIK_MODELS.anthropic].sort()).toEqual(installed('anthropic'));
  });

  it('the default model supports structured output and reasoning effort "low"', () => {
    const m = supportedModels.find((x) => x.specification.name === 'gemini-3.5-flash-lite')!.specification;
    expect(m.supportsStructuredOutput).toBe(true);
    expect(m.supportedReasoningEfforts).toContain('low');
  });

  it('converts strict JSON Schema to the subset Gemini accepts', () => {
    const js = providerJsonSchema(CaseOutput, 'gemini') as { properties: Record<string, Record<string, unknown>> };
    const text = JSON.stringify(js);
    expect(text).not.toMatch(/additionalProperties|\$schema|"type":"null"/);
    expect(js.properties.changeReason.nullable).toBe(true);
    expect(toGeminiSchema({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toEqual({ type: 'string', nullable: true });
  });
});

describe('assessment classification guard', () => {
  const calc = (topic: string, kind: string, output = '1') => ({ topic, kind, output });
  it('only allows readings the calculations support', () => {
    expect(allowedClassifications([], null).allowed).toContain('insufficient_evidence');
    const declared = [calc('billed_vs_declared:charge_difference', 'charge_difference')];
    expect(allowedClassifications(declared, null).allowed).toContain('declared_volume_conflicts_with_bill');
    expect(allowedClassifications(declared, null).allowed).not.toContain('measured_volume_differs_basis_unresolved');
    expect(allowedClassifications(declared, null).allowed).not.toContain('insufficient_evidence');
    const measured = [...declared, calc('billed_vs_measured:charge_difference', 'charge_difference')];
    expect(allowedClassifications(measured, { termsStatus: 'terms_missing' }).allowed).toContain('measured_volume_differs_basis_unresolved');
    expect(allowedClassifications(measured, { termsStatus: 'terms_missing' }).allowed).not.toContain('contract_term_may_explain_bill');
    const contract = [...measured, calc('billed_vs_contract_term:charge_difference', 'charge_difference')];
    const v = allowedClassifications(contract, { termsStatus: 'terms_found' });
    expect(v.allowed).toContain('contract_term_may_explain_bill');
    expect(v.allowed).not.toContain('measured_volume_differs_basis_unresolved');
    expect(v.reasons.measured_volume_differs_basis_unresolved).toMatch(/contract term/);
  });
});
