/**
 * Wraps whichever InferenceRunner is in use (the real DefaultInferenceRunner, or the labelled test runner).
 *
 * Why it exists: Mozaik's `runLoop` is fire-and-forget and does not surface a failed model call anywhere
 * (the loop's promise is not awaited), so a provider error would otherwise vanish. This wrapper
 *   - enforces the per-run model-call budget,
 *   - reports provider failures and timings to the task that owns the call (matched by ModelContext id),
 *   - never records prompts or document text.
 */
import type { InferenceInput, InferenceOutput, InferenceRunner, SemanticEvent } from '@mozaik-ai/core';

export interface CallHooks {
  onStart(contextId: string, model: string): void;
  onFinish(contextId: string, output: InferenceOutput): void;
  onError(contextId: string, error: Error): void;
}

export class BudgetExceeded extends Error {
  constructor(public readonly limit: number) {
    super(`Model-call budget of ${limit} calls for this run was reached.`);
    this.name = 'BudgetExceeded';
  }
}

export class InstrumentedRunner implements InferenceRunner {
  calls = 0;
  constructor(
    private readonly inner: InferenceRunner,
    private readonly maxCalls: number,
    private readonly hooks: CallHooks,
    private readonly onCall: (n: number) => void = () => {},
  ) {}

  async run(request: InferenceInput): Promise<InferenceOutput> {
    const id = request.context.id;
    if (this.calls >= this.maxCalls) {
      const err = new BudgetExceeded(this.maxCalls);
      this.hooks.onError(id, err);
      throw err;
    }
    this.calls++;
    this.onCall(this.calls);
    this.hooks.onStart(id, request.model);
    try {
      const out = await this.inner.run(request);
      this.hooks.onFinish(id, out);
      return out;
    } catch (e) {
      this.hooks.onError(id, e as Error);
      throw e;
    }
  }

  stream(request: InferenceInput): AsyncGenerator<SemanticEvent> {
    return this.inner.stream(request);
  }
}
