/**
 * End-to-end check against a running deployment (local container or hosted). It only uses the public HTTP API, the way
 * a browser would, and never prints secrets. Modes:
 *
 *   node scripts/hosted-check.mjs ready  <base-url>
 *   node scripts/hosted-check.mjs run    <base-url>   example investigation -> published survey -> revision -> exports
 *   node scripts/hosted-check.mjs verify <base-url>   after a restart: the same case, letter and exports are still there
 *   node scripts/hosted-check.mjs start  <base-url>   start an example investigation and return once an agent is running (to interrupt it)
 *   node scripts/hosted-check.mjs retry  <base-url>   after an interruption: wait for the run to be marked failed, retry, wait for completion
 *   node scripts/hosted-check.mjs interrupt <base-url>  start, then stop the Render service mid-run (suspend + resume through the
 *                                                        Render API), then retry. Needs RENDER_API_KEY (env or .env.render).
 *
 * `run` uses the configured real model (no test mode) and spends free-tier quota. State for `verify` and `retry` is kept
 * in .data/hosted/state.json (git-ignored): it contains the browser cookie of the example case, so keep it private.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const [mode, baseArg] = process.argv.slice(2);
if (!['ready', 'run', 'verify', 'start', 'retry', 'interrupt'].includes(mode) || !baseArg) {
  console.log('usage: node scripts/hosted-check.mjs <ready|run|verify|start|retry|interrupt> <base-url>');
  process.exit(2);
}
const base = baseArg.replace(/\/$/, '');
const STATE = process.env.HOSTED_STATE || '.data/hosted/state.json';
const SLUG = process.env.EXAMPLE_SLUG || 'volume-dispute-aug-2026';
let jar = {};
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function req(path, init = {}, useJar = true) {
  const res = await fetch(base + path, { ...init, redirect: 'manual', headers: { Origin: base, 'content-type': 'application/json', ...(useJar ? { cookie: cookieHeader() } : {}), ...init.headers } });
  if (useJar) for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return res;
}
const json = async (path, init, useJar) => { const r = await req(path, init, useJar); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function waitIdle(caseId, label, limitMs = 15 * 60_000) {
  const t0 = Date.now();
  for (;;) {
    await sleep(4000);
    const r = await json(`/api/cases/${caseId}`);
    if (r.status !== 200) { console.log(`  ${label}: state request returned ${r.status}`); if (Date.now() - t0 > limitMs) return null; continue; }
    const s = r.body;
    const run = s.latestRun;
    process.stdout.write(`\r  ${label} +${Math.round((Date.now() - t0) / 1000)}s run=${run?.status ?? '-'} assessment=${s.latestAssessment?.version ?? '-'}      `);
    if (!s.activeRun && run && ['completed', 'partial', 'failed', 'cancelled'].includes(run.status)) { console.log(); return s; }
    if (Date.now() - t0 > limitMs) { console.log('\n  timeout'); return s; }
  }
}
const diffOf = (s) => s?.summary?.find((x) => /difference/i.test(x.label))?.value ?? null;

async function ready() {
  const r = await json('/api/ready', {}, false);
  console.log(JSON.stringify(r.body, null, 1));
  check('GET /api/ready is 200 (database, worker heartbeat and model credential all present)', r.status === 200, `status ${r.status}${r.body?.reasons?.length ? ' reasons: ' + r.body.reasons.join('; ') : ''}`);
  const h = await json('/api/health', {}, false);
  check('GET /api/health is 200', h.status === 200, `status ${h.status}`);
  check('test mode is not active', r.body?.inference?.mode === 'live', `mode ${r.body?.inference?.mode ?? 'unavailable'}`);
}

async function exportAll(caseId) {
  const made = await json(`/api/cases/${caseId}/exports`, { method: 'POST', body: JSON.stringify({ reviewed: true }) });
  check('exports created (letter PDF, evidence summary PDF, CSV)', made.status === 200 || made.status === 201, `status ${made.status}${made.body?.message ? ' ' + made.body.message : ''}`);
  const list = (await json(`/api/cases/${caseId}/exports`)).body?.exports ?? [];
  const saved = [];
  for (const e of list.slice(0, 6)) {
    const r = await req(`/api/cases/${caseId}/exports/${e.id}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const isPdf = /\.pdf$/i.test(e.filename);
    check(`download ${e.filename}`, r.status === 200 && buf.length > 500 && (!isPdf || buf.subarray(0, 5).toString() === '%PDF-'), `${buf.length} bytes`);
    saved.push({ id: e.id, filename: e.filename, bytes: buf.length, sha256: sha(buf) });
  }
  return saved;
}

async function run() {
  const started = await json(`/api/demo/cases/${SLUG}/run`, { method: 'POST' });
  check('example case created and investigation queued', started.status === 202, `status ${started.status}${started.body?.message ? ' ' + started.body.message : ''}`);
  if (started.status !== 202) return;
  const caseId = started.body.caseId;
  console.log('case', caseId.slice(0, 8));
  const first = await waitIdle(caseId, 'first investigation');
  check('first investigation completed on the real model', first?.latestRun?.status === 'completed' && first?.latestRun?.inferenceMode !== 'test', `run ${first?.latestRun?.status}, assessment v${first?.latestAssessment?.version}, ${first?.latestRun?.modelCalls} model calls`);
  const add = await json(`/api/cases/${caseId}/demo-evidence`, { method: 'POST', body: JSON.stringify({ stepId: 'survey' }) });
  check('survey evidence added', add.status === 202 || add.status === 200, `status ${add.status}`);
  await sleep(3000);
  const second = await waitIdle(caseId, 'survey revision');
  check('survey revision completed', second?.latestRun?.status === 'completed' && (second?.latestAssessment?.version ?? 0) > (first?.latestAssessment?.version ?? 0), `assessment v${first?.latestAssessment?.version} -> v${second?.latestAssessment?.version}, ${second?.latestRun?.modelCalls} calls`);
  check('difference under review is ₦189,700 after the survey', diffOf(second) === '₦189,700', String(diffOf(second)));
  const saved = await exportAll(caseId);
  fs.mkdirSync('.data/hosted', { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ base, caseId, jar, exports: saved, assessment: second?.latestAssessment?.version, draft: second?.draft?.version ?? null, savedAt: new Date().toISOString() }, null, 2));
  console.log(`state saved to ${STATE} (contains a cookie; keep private)`);
}

function loadState() {
  if (!fs.existsSync(STATE)) { console.log(`no ${STATE}: run "run" first`); process.exit(2); }
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  jar = st.jar;
  return st;
}

async function verify() {
  const st = loadState();
  await ready();
  const r = await json(`/api/cases/${st.caseId}`);
  check('the same case is still there after the restart', r.status === 200, `status ${r.status}`);
  check('assessment version unchanged', r.body?.latestAssessment?.version === st.assessment, `v${r.body?.latestAssessment?.version} (saved v${st.assessment})`);
  check('letter draft still stored', !!r.body?.draft, `draft v${r.body?.draft?.version ?? '-'}`);
  for (const e of st.exports) {
    const x = await req(`/api/cases/${st.caseId}/exports/${e.id}`);
    const buf = Buffer.from(await x.arrayBuffer());
    check(`export ${e.filename} identical after restart`, x.status === 200 && sha(buf) === e.sha256, `${buf.length} bytes`);
  }
  const events = await req(`/api/cases/${st.caseId}/events?after=0`);
  check('event stream replays from the start (SSE)', events.status === 200 && /text\/event-stream/.test(events.headers.get('content-type') ?? ''), `status ${events.status}`);
  await events.body?.cancel().catch(() => {});
  // isolation: a browser without the case cookie must not see the case or its exports
  const anon = await json(`/api/cases/${st.caseId}`, {}, false);
  check('another browser gets 404 for the case', anon.status === 404, `status ${anon.status}`);
  if (st.exports[0]) {
    const anonX = await req(`/api/cases/${st.caseId}/exports/${st.exports[0].id}`, {}, false);
    check('another browser gets 404 for an export', anonX.status === 404, `status ${anonX.status}`);
  }
  const list = await json('/api/cases', {}, false);
  check('signed-out visitor cannot list cases', list.status === 401, `status ${list.status}`);
}

async function start() {
  const started = await json(`/api/demo/cases/${SLUG}/run`, { method: 'POST' });
  check('example case created and investigation queued', started.status === 202, `status ${started.status}`);
  if (started.status !== 202) return;
  const caseId = started.body.caseId;
  const t0 = Date.now();
  for (;;) {
    await sleep(2000);
    const s = (await json(`/api/cases/${caseId}`)).body;
    const working = s?.agents?.some((a) => ['investigating', 'revising'].includes(a.status));
    if (working || Date.now() - t0 > 600_000) { check('an agent is running (ready to interrupt)', !!working, `after ${Math.round((Date.now() - t0) / 1000)} s`); break; }
  }
  fs.mkdirSync('.data/hosted', { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ base, caseId, jar, exports: [], savedAt: new Date().toISOString() }, null, 2));
}

async function retry() {
  const st = loadState();
  const t0 = Date.now();
  let s;
  for (;;) {
    const r0 = await json(`/api/cases/${st.caseId}`);
    s = r0.body;
    if (r0.status === 200 && ['failed', 'partial', 'completed', 'cancelled'].includes(s?.latestRun?.status)) break;
    if (Date.now() - t0 > 8 * 60_000) break;
    await sleep(3000);
  }
  const waited = Math.round((Date.now() - t0) / 1000);
  console.log(`latest run: ${s?.latestRun?.status}${s?.latestRun?.errorCode ? ' (' + s.latestRun.errorCode + ')' : ''}, state settled ${waited} s after the check started`);
  check('the interrupted run is reported as failed with a reason, not left running', s?.latestRun?.status === 'failed' && !!s?.latestRun?.errorCode, `${s?.latestRun?.errorCode ?? '-'}: ${String(s?.latestRun?.errorMessage ?? '').slice(0, 90)}`);
  const r = await json(`/api/cases/${st.caseId}/retry`, { method: 'POST' });
  check('retry accepted', r.status === 202 || r.status === 200, `status ${r.status}${r.body?.message ? ' ' + r.body.message : ''}`);
  const done = await waitIdle(st.caseId, 'retry');
  check('retry completed', done?.latestRun?.status === 'completed', `run ${done?.latestRun?.status}, assessment v${done?.latestAssessment?.version}`);
}

/** Render API (only for `interrupt`). The key is read from the environment or .env.render and is never printed. */
function renderKey() {
  if (process.env.RENDER_API_KEY) return process.env.RENDER_API_KEY.trim();
  if (fs.existsSync('.env.render')) {
    const line = fs.readFileSync('.env.render', 'utf8').split(/\r?\n/).find((l) => l.startsWith('RENDER_API_KEY='));
    if (line) return line.slice('RENDER_API_KEY='.length).trim();
  }
  return null;
}
async function renderApi(key, path, method = 'GET') {
  const r = await fetch('https://api.render.com/v1' + path, { method, headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function interrupt() {
  const key = renderKey();
  if (!key) { console.log('Set RENDER_API_KEY (or put RENDER_API_KEY=... in .env.render) first. Create it in Render: Account Settings -> API Keys.'); process.exit(2); }
  const host = new URL(base).host;
  const list = await renderApi(key, '/services?limit=100');
  check('Render API key accepted', list.status === 200, `status ${list.status}`);
  if (list.status !== 200) return;
  const svc = (list.body ?? []).map((x) => x.service ?? x).find((x) => (x.serviceDetails?.url ?? '').includes(host));
  check(`Render service for ${host} found`, !!svc, svc ? `${svc.name} (${svc.id})` : 'no service with that URL');
  if (!svc) return;

  await start();
  if (!results.every((r) => r.ok)) return;
  const st = loadState();
  const before = (await json(`/api/cases/${st.caseId}`)).body?.latestRun?.status;
  const sus = await renderApi(key, `/services/${svc.id}/suspend`, 'POST');
  check('service suspended while the investigation was running', sus.status >= 200 && sus.status < 300 && before === 'running', `suspend status ${sus.status}, run was ${before}`);
  // wait until the instance has actually stopped serving
  const t0 = Date.now();
  for (;;) {
    await sleep(3000);
    const h = await fetch(base + '/api/health').then((r) => r.status).catch(() => 0);
    if (h !== 200 || Date.now() - t0 > 120_000) { console.log(`  instance stopped serving after ${Math.round((Date.now() - t0) / 1000)} s (health ${h})`); break; }
  }
  const res = await renderApi(key, `/services/${svc.id}/resume`, 'POST');
  check('service resumed', res.status >= 200 && res.status < 300, `status ${res.status}`);
  const t1 = Date.now();
  let ok = false;
  for (;;) {
    await sleep(5000);
    const r = await fetch(base + '/api/ready').then((x) => x.status).catch(() => 0);
    process.stdout.write(`\r  waiting for the service to come back +${Math.round((Date.now() - t1) / 1000)}s (ready ${r})   `);
    if (r === 200) { ok = true; break; }
    if (Date.now() - t1 > 15 * 60_000) break;
  }
  console.log();
  check('service is ready again after the restart', ok, `after ${Math.round((Date.now() - t1) / 1000)} s`);
  if (ok) await retry();
}

if (mode === 'ready') await ready();
if (mode === 'run') { await ready(); await run(); }
if (mode === 'verify') await verify();
if (mode === 'start') await start();
if (mode === 'retry') await retry();
if (mode === 'interrupt') await interrupt();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
