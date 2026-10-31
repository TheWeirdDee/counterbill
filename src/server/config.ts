/** Central, validated environment access. Server-side only: nothing here may reach the browser. */
import 'dotenv/config';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

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
  get model(): string {
    return process.env.MOZAIK_MODEL ?? 'gpt-5.5';
  },
  get inferenceMode(): 'live' | 'test' {
    return process.env.COUNTERBILL_INFERENCE === 'test' ? 'test' : 'live';
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
  get maxAgentRevisions() {
    return int('MAX_AGENT_REVISIONS', 4);
  },
  get maxModelCallsPerRun() {
    return int('MAX_MODEL_CALLS_PER_RUN', 24);
  },
  get agentTaskTimeoutMs() {
    return int('AGENT_TASK_TIMEOUT_MS', 180_000);
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
  | { ready: false; code: 'missing_api_key' | 'unsupported_model'; message: string; model: string };

/** Whether an investigation can run right now. Never silently falls back to test mode. */
export function inferenceReadiness(): InferenceReadiness {
  const model = config.model;
  if (config.inferenceMode === 'test') return { ready: true, mode: 'test', model: 'counterbill-test-runner' };
  const need = requiredProviderKey(model);
  if (!need) {
    return {
      ready: false,
      code: 'unsupported_model',
      model,
      message: `MOZAIK_MODEL="${model}" is not a model Mozaik 4.2 ships (gpt-5.x, claude-*, gemini-*, deepseek-*). Set MOZAIK_MODEL to a documented model.`,
    };
  }
  if (!process.env[need.env]) {
    return {
      ready: false,
      code: 'missing_api_key',
      model,
      message: `Live investigations need ${need.env} (${need.provider}) for MOZAIK_MODEL="${model}". Add it to .env on the server and restart the worker. See README → Setup.`,
    };
  }
  return { ready: true, mode: 'live', model };
}
