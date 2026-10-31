/** Central, validated environment access. Server-side only: nothing here may reach the browser. */
import 'dotenv/config';

// Accept a lower-case variable name (easy to type, and Windows treats env names case-insensitively) so a key saved as
// `gemini_api_key` still works on a Linux host, where the SDK reads exactly `GEMINI_API_KEY`.
for (const name of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
  const lower = name.toLowerCase();
  if (!process.env[name] && process.env[lower]) process.env[name] = process.env[lower];
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Models that the installed @mozaik-ai/core (4.2.0) ships, by provider. A unit test compares this list with the package's
 * own `supportedModels`, so it cannot drift silently when the dependency is upgraded.
 */
export const MOZAIK_MODELS = {
  openai: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.5', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra'],
  anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'],
  google: ['gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-flash'],
} as const;

export const isGeminiModel = (model: string) => /^gemini-/.test(model);

export const config = {
  get databaseUrl(): string {
    return process.env.DATABASE_URL ?? 'postgres://counterbill:counterbill@127.0.0.1:54329/counterbill';
  },
  get publicAppUrl(): string {
    return process.env.PUBLIC_APP_URL ?? 'http://localhost:3000';
  },
  get sessionSecret(): string {
    return process.env.SESSION_SECRET ?? 'dev-only-insecure-session-secret';
  },
  /** Default: the Gemini model that is both supported by Mozaik and served on the free tier (see README → Gemini free tier). */
  get model(): string {
    return process.env.MOZAIK_MODEL || 'gemini-3.5-flash-lite';
  },
  get inferenceMode(): 'live' | 'test' {
    return process.env.COUNTERBILL_INFERENCE === 'test' ? 'test' : 'live';
  },
  /** Thinking level passed through Mozaik. Defaults to "low" for Gemini (fast, and kind to free-tier quotas). */
  get reasoningEffort(): string | undefined {
    return process.env.MOZAIK_REASONING_EFFORT || (isGeminiModel(this.model) ? 'low' : undefined);
  },
  /** Client-side pacing so a free-tier key is not hammered. 0 disables. Loops still run concurrently; only the call start is paced. */
  get modelRequestsPerMinute(): number {
    return int('MODEL_REQUESTS_PER_MINUTE', isGeminiModel(this.model) ? 10 : 0);
  },
  get modelMaxRetries() {
    return int('MODEL_MAX_RETRIES', 3);
  },
  /** Longest a single rate-limit wait may be. A longer `retryDelay` is treated as an exhausted quota and reported, not waited out. */
  get modelMaxWaitMs() {
    return int('MODEL_MAX_WAIT_SECONDS', 75) * 1000;
  },
  get maxCaseDocuments() {
    return int('MAX_CASE_DOCUMENTS', 10);
  },
  get maxFileBytes() {
    return int('MAX_FILE_MB', 15) * 1024 * 1024;
  },
  get maxCaseBytes() {
    return int('MAX_CASE_MB', 50) * 1024 * 1024;
  },
  /** Attempts per agent task: a validation failure is fed back to the model and retried, up to this many times in total. */
  get maxTaskAttempts() {
    return Math.max(1, int('MAX_TASK_ATTEMPTS', 3));
  },
  get maxAgentRevisions() {
    return int('MAX_AGENT_REVISIONS', 4);
  },
  get maxModelCallsPerRun() {
    return int('MAX_MODEL_CALLS_PER_RUN', 40);
  },
  get agentTaskTimeoutMs() {
    return int('AGENT_TASK_TIMEOUT_MS', 300_000);
  },
  get demoRunsPerIpPerHour() {
    return int('DEMO_RUNS_PER_IP_PER_HOUR', 6);
  },
  get isProduction() {
    return process.env.NODE_ENV === 'production';
  },
};

/** Which provider key the configured model needs, or null when the model is unknown to us. */
export function requiredProviderKey(model: string): { env: string; provider: string } | null {
  if (/^gpt-/.test(model)) return { env: 'OPENAI_API_KEY', provider: 'OpenAI' };
  if (/^claude-/.test(model)) return { env: 'ANTHROPIC_API_KEY', provider: 'Anthropic' };
  if (/^gemini-/.test(model)) return { env: 'GEMINI_API_KEY', provider: 'Gemini' };
  if (/^deepseek-/.test(model)) return { env: 'OPENAI_API_KEY', provider: 'DeepSeek (OpenAI-compatible)' };
  return null;
}

export type InferenceReadiness =
  | { ready: true; mode: 'live' | 'test'; model: string }
  | { ready: false; code: 'missing_api_key' | 'unsupported_model' | 'test_mode_blocked'; message: string; model: string };

/** Whether an investigation can run right now. Never silently falls back to test mode or to a different model. */
export function inferenceReadiness(): InferenceReadiness {
  const model = config.model;
  if (config.inferenceMode === 'test') {
    // The scripted stand-in is for tests. A production build refuses it unless that is allowed on purpose, so a stray
    // variable on a deployed server can never turn the product into canned output.
    if (process.env.NODE_ENV === 'production' && process.env.COUNTERBILL_ALLOW_TEST_IN_PRODUCTION !== '1') {
      return {
        ready: false,
        code: 'test_mode_blocked',
        model: 'counterbill-test-runner',
        message: 'COUNTERBILL_INFERENCE=test is set on a production build. Test mode is refused there unless COUNTERBILL_ALLOW_TEST_IN_PRODUCTION=1 is also set. Unset COUNTERBILL_INFERENCE to use the configured model.',
      };
    }
    return { ready: true, mode: 'test', model: 'counterbill-test-runner' };
  }
  const all = Object.values(MOZAIK_MODELS).flat() as string[];
  const need = requiredProviderKey(model);
  if (!need || !all.includes(model)) {
    return {
      ready: false,
      code: 'unsupported_model',
      model,
      message: `MOZAIK_MODEL="${model}" is not a model the installed Mozaik (4.2.0) supports. Gemini models it supports: ${MOZAIK_MODELS.google.join(', ')}. Counterbill will not substitute another model.`,
    };
  }
  if (!process.env[need.env]) {
    return {
      ready: false,
      code: 'missing_api_key',
      model,
      message: `Live investigations need ${need.env} (${need.provider}) for MOZAIK_MODEL="${model}". Put it in the .env file in the project root (never in git) and restart the worker. See README → Setup.`,
    };
  }
  return { ready: true, mode: 'live', model };
}
