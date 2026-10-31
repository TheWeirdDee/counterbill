/**
 * Wraps whichever InferenceRunner is in use (the real DefaultInferenceRunner, or the labelled test runner).
 *
 * Why it exists: Mozaik's `runLoop` is fire-and-forget and does not surface a failed model call anywhere
 * (the loop's promise is not awaited), so a provider error would otherwise vanish. This wrapper
 *   - enforces the per-run model-call budget,
 *   - paces calls (requests per minute) so a free-tier key is not hammered, without serialising the agent loops,
 *   - retries rate limits (429) and transient overloads (5xx) a bounded number of times, honouring the provider's own
 *     retry delay, and reports each wait so the UI can say so,
 *   - turns an exhausted quota or a rejected key into a clear typed error instead of retrying forever,
 *   - reports provider failures and timings to the task that owns the call (matched by ModelContext id),
 *   - never records prompts or document text, and never substitutes another model or a canned answer.
 */
import type { InferenceInput, InferenceOutput, InferenceRunner, SemanticEvent } from '@mozaik-ai/core';

export interface CallHooks {
  onStart(contextId: string, model: string): void;
  onFinish(contextId: string, output: InferenceOutput): void;
  onError(contextId: string, error: Error): void;
  onRetry?(contextId: string, info: { attempt: number; waitMs: number; reason: string; code: string }): void;
}

export class BudgetExceeded extends Error {
  constructor(public readonly limit: number) {
    super(`Model-call budget of ${limit} calls for this run was reached.`);
    this.name = 'BudgetExceeded';
  }
}

export type ProviderErrorCode = 'provider_quota_exhausted' | 'provider_rate_limited' | 'provider_auth' | 'provider_model_unavailable' | 'provider_unavailable' | 'provider_bad_request';

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface RetryPolicy {
  maxRetries: number;
  maxWaitMs: number;
  requestsPerMinute: number;
  /** Cross-process pacing (e.g. the database-backed limiter). When given, it replaces the in-process window. */
  acquire?: () => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
}

/** Pull a retry delay (ms) out of a provider error: Gemini's RetryInfo `retryDelay: "12.3s"` or "Please retry in 12.3s". */
export function retryDelayMs(err: unknown): number | null {
  const text = `${(err as Error)?.message ?? ''} ${safeJson(err)}`;
  const m = text.match(/retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i) ?? text.match(/retry in (\d+(?:\.\d+)?)\s*s/i) ?? text.match(/retry[- ]after"?\s*[:=]?\s*"?(\d+(?:\.\d+)?)/i);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, Object.getOwnPropertyNames(v as object)).slice(0, 4000);
  } catch {
    return '';
  }
}

/** Map a raw SDK/HTTP error to a typed provider error (or null when it is not one we recognise). */
export function classifyProviderError(err: unknown, model: string): ProviderError | null {
  const e = err as { status?: number; code?: number | string; message?: string };
  const text = `${e?.message ?? ''} ${safeJson(err)}`;
  const status = typeof e?.status === 'number' ? e.status : typeof e?.code === 'number' ? e.code : (text.match(/"code"\s*:\s*(\d{3})/)?.[1] ? Number(text.match(/"code"\s*:\s*(\d{3})/)![1]) : undefined);
  if (status === 429 || /RESOURCE_EXHAUSTED|rate.?limit/i.test(text)) {
    const delay = retryDelayMs(err);
    const perDay = /PerDay|per day|daily/i.test(text);
    return new ProviderError(
      perDay || (delay != null && delay > 10 * 60_000) ? 'provider_quota_exhausted' : 'provider_rate_limited',
      perDay || (delay != null && delay > 10 * 60_000)
        ? `The provider's quota for ${model} is used up${delay ? ` (it resets in about ${Math.round(delay / 3_600_000)} h)` : ''}. On a free tier this is a daily or per-model limit; wait for it to reset or choose another model you have access to. Counterbill will not switch models for you.`
        : `The provider rate-limited ${model}${delay ? ` and asked to wait ${Math.ceil(delay / 1000)} s` : ''}.`,
      true,
      429,
    );
  }
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED|invalid api key/i.test(text)) {
    return new ProviderError('provider_auth', 'The model provider rejected the API key. Check the key in .env (and that it is enabled for the Gemini API), then restart the worker.', false, status ?? 403);
  }
  if (status === 404 || /models\/.* is not found|NOT_FOUND/i.test(text)) {
    return new ProviderError('provider_model_unavailable', `The provider does not offer ${model} to this key. Pick a model your account can use via MOZAIK_MODEL.`, false, 404);
  }
  if (status === 400) {
    return new ProviderError('provider_bad_request', `The provider rejected the request (${(e?.message ?? '').slice(0, 220)})`, false, 400);
  }
  if (status && status >= 500) {
    return new ProviderError('provider_unavailable', `The provider is temporarily unavailable (HTTP ${status}).`, true, status);
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network/i.test(text)) {
    return new ProviderError('provider_unavailable', 'Could not reach the model provider (network error).', true);
  }
  return null;
}

export class InstrumentedRunner implements InferenceRunner {
  calls = 0;
  rateLimitWaits = 0;
  private readonly starts: number[] = [];
  private gate: Promise<void> = Promise.resolve();

  constructor(
    private readonly inner: InferenceRunner,
    private readonly maxCalls: number,
    private readonly hooks: CallHooks,
    private readonly onCall: (n: number) => void = () => {},
    private readonly policy: RetryPolicy = { maxRetries: 0, maxWaitMs: 0, requestsPerMinute: 0 },
  ) {}

  private sleep(ms: number) {
    return (this.policy.sleep ?? ((n: number) => new Promise<void>((r) => setTimeout(r, n))))(ms);
  }

  /** Sliding-window pacing. Calls start as soon as the window allows; many loops can still be in flight together. */
  private async pace(): Promise<void> {
    if (this.policy.acquire) {
      await this.policy.acquire();
      return;
    }
    const rpm = this.policy.requestsPerMinute;
    if (!rpm) return;
    const turn = this.gate.then(async () => {
      for (;;) {
        const now = Date.now();
        while (this.starts.length && now - this.starts[0] >= 60_000) this.starts.shift();
        if (this.starts.length < rpm) {
          this.starts.push(Date.now());
          return;
        }
        await this.sleep(Math.max(50, 60_000 - (now - this.starts[0]) + 20));
      }
    });
    this.gate = turn.catch(() => {});
    return turn;
  }

  async run(request: InferenceInput): Promise<InferenceOutput> {
    const id = request.context.id;
    let attempt = 0;
    for (;;) {
      if (this.calls >= this.maxCalls) {
        const err = new BudgetExceeded(this.maxCalls);
        this.hooks.onError(id, err);
        throw err;
      }
      await this.pace();
      this.calls++;
      this.onCall(this.calls);
      this.hooks.onStart(id, request.model);
      try {
        const out = await this.inner.run(request);
        this.hooks.onFinish(id, out);
        return out;
      } catch (e) {
        const typed = classifyProviderError(e, request.model);
        const err = typed ?? (e as Error);
        const delay = retryDelayMs(e);
        const canRetry = typed?.retryable && attempt < this.policy.maxRetries;
        if (typed && canRetry) {
          const base = typed.code === 'provider_unavailable' ? Math.min(2000 * 2 ** attempt, 15_000) : (delay ?? 5000 * (attempt + 1)) + 500;
          if (base <= this.policy.maxWaitMs) {
            attempt++;
            this.rateLimitWaits++;
            this.hooks.onRetry?.(id, { attempt, waitMs: base, reason: typed.message, code: typed.code });
            await this.sleep(base);
            continue;
          }
          // The provider wants a longer wait than we are willing to hold a run for: report it, do not loop.
          const quota = new ProviderError('provider_quota_exhausted', `${typed.message} The required wait (${Math.ceil(base / 1000)} s) exceeds the ${Math.round(this.policy.maxWaitMs / 1000)} s limit, so the run stops here with its partial results. Retry later.`, true, 429);
          this.hooks.onError(id, quota);
          throw quota;
        }
        this.hooks.onError(id, err);
        throw err;
      }
    }
  }

  stream(request: InferenceInput): AsyncGenerator<SemanticEvent> {
    return this.inner.stream(request);
  }
}
