/**
 * Drives a sample investigation through the running app's HTTP API (so the real worker and the configured model do the
 * work) and prints what actually happened. Usage, with `pnpm dev` running and a model key in .env:
 *
 *   pnpm live:check volume-dispute-aug-2026 survey rate-sheet
 *   pnpm live:check cargo-classification-jun-2026
 *
 * It never supplies answers itself: it only starts the run, adds the published evidence steps you name, waits, and saves
 * the sanitised trace and a summary to .data/live-check/.
 */
import fs from 'node:fs';
import 'dotenv/config';
const base = process.env.PUBLIC_APP_URL ?? 'http://localhost:3000';
if (!process.argv[2]) { console.log('usage: pnpm live:check <sample-slug> [step ids...]'); process.exit(2); }
const [, , slug, ...steps] = process.argv;
const jar = {};
const req = async (path, init = {}) => {
  const res = await fetch(base + path, { ...init, headers: { Origin: base, 'content-type': 'application/json', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(init.headers ?? {}) } });
  for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return res;
};
const j = async (path, init) => { const r = await req(path, init); return { status: r.status, body: await r.json().catch(() => null) }; };
const started = await j(`/api/demo/cases/${slug}/run`, { method: 'POST' });
if (started.status >= 300) { console.log('START FAILED', started.status, JSON.stringify(started.body)); process.exit(1); }
const caseId = started.body.caseId;
console.log('case', caseId);
const waitIdle = async (label) => {
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const s = (await j(`/api/cases/${caseId}`)).body;
    const run = s.latestRun;
    process.stdout.write(`\r${label} +${Math.round((Date.now() - t0) / 1000)}s run=${run?.status} assess=${s.latestAssessment?.version ?? '-'} agents=${s.agents.map((a) => a.role[0] + ':' + a.status[0]).join('')}   `);
    if (!s.activeRun && run && ['completed', 'partial', 'failed', 'cancelled'].includes(run.status)) { console.log(); return s; }
    if (Date.now() - t0 > 900000) { console.log('\nTIMEOUT'); return s; }
  }
};
let state = await waitIdle('first run');
const out = { slug, caseId, stages: [] };
const snap = (label, s) => {
  const calc = (t) => s.calculations.find((c) => c.topic === t && c.status === 'current')?.display;
  out.stages.push({ label, run: s.latestRun && { kind: s.latestRun.kind, status: s.latestRun.status, calls: s.latestRun.modelCalls, error: s.latestRun.errorMessage }, assessment: s.latestAssessment && { v: s.latestAssessment.version, cls: s.latestAssessment.classification, headline: s.latestAssessment.headline, reason: s.latestAssessment.changeReason }, diffs: { declared: calc('billed_vs_declared:charge_difference'), measured: calc('billed_vs_measured:charge_difference'), contract: calc('billed_vs_contract_term:charge_difference') }, facts: s.facts.filter((f) => f.status === 'active').length, findings: s.findings.filter((f) => f.status !== 'superseded').length, superseded: s.findings.filter((f) => f.status === 'superseded').length, draft: s.draft && { v: s.draft.version }, agentsFailed: s.agents.filter((a) => a.status === 'failed').map((a) => `${a.role}: ${a.error}`) });
  console.log(JSON.stringify(out.stages.at(-1), null, 1));
};
snap('first', state);
for (const step of steps) {
  const r = await j(`/api/cases/${caseId}/demo-evidence`, { method: 'POST', body: JSON.stringify({ stepId: step }) });
  console.log('add', step, r.status, JSON.stringify(r.body));
  await new Promise((r2) => setTimeout(r2, 3000));
  state = await waitIdle(step);
  snap(step, state);
}
const trace = await req(`/api/cases/${caseId}/trace`);
fs.mkdirSync('.data/live-check', { recursive: true });
fs.writeFileSync(`.data/live-check/trace-${slug}.json`, await trace.text());
fs.writeFileSync(`.data/live-check/summary-${slug}.json`, JSON.stringify(out, null, 2));
console.log(`saved trace + summary for ${slug} in .data/live-check/`);
