'use client';

import { useMemo, useState } from 'react';
import { ASSESSMENT_CLASS_LABEL } from '@/domain/schemas';
import { fmtDateTime, fmtTime, StatusChip } from '../ui';
import { describeEvent, ROLE_LABEL, useWs } from './context';
import type { AgentRunRow } from '@/db/repo';

interface Interval {
  role: string;
  task: AgentRunRow;
  start: number;
  end: number | null;
}

function overlaps(intervals: Interval[], now: number) {
  const out: { a: string; b: string; ms: number; loopA?: string | null; loopB?: string | null }[] = [];
  for (let i = 0; i < intervals.length; i++)
    for (let j = i + 1; j < intervals.length; j++) {
      const x = intervals[i];
      const y = intervals[j];
      if (x.role === y.role) continue;
      const ms = Math.min(x.end ?? now, y.end ?? now) - Math.max(x.start, y.start);
      if (ms > 0) out.push({ a: x.role, b: y.role, ms, loopA: x.task.mozaikLoopId, loopB: y.task.mozaikLoopId });
    }
  return out.sort((p, q) => q.ms - p.ms);
}

export function ActivityView() {
  const { state, events, connection } = useWs();
  const [view, setView] = useState<'events' | 'concurrency'>('concurrency');
  const [runId, setRunId] = useState<string>(state.latestRun?.id ?? '');
  const [showTrace, setShowTrace] = useState(false);
  const run = state.runs.find((r) => r.id === (runId || state.latestRun?.id)) ?? state.latestRun;

  const tasks = useMemo(() => state.agentRuns.filter((t) => t.runId === run?.id), [state.agentRuns, run?.id]);
  const intervals: Interval[] = tasks.map((t) => ({ role: t.agentRole, task: t, start: new Date(t.startedAt).getTime(), end: t.finishedAt ? new Date(t.finishedAt).getTime() : null }));
  // eslint-disable-next-line react-hooks/purity -- the open end of a running span is "now"; the view re-renders on every event
  const now = Date.now();
  const t0 = intervals.length ? Math.min(...intervals.map((i) => i.start)) : now;
  const t1 = intervals.length ? Math.max(...intervals.map((i) => i.end ?? now), t0 + 1) : now + 1;
  const span = Math.max(1, t1 - t0);
  const pct = (t: number) => `${(((t - t0) / span) * 100).toFixed(2)}%`;
  const wid = (a: number, b: number) => `${Math.max(0.4, ((b - a) / span) * 100).toFixed(2)}%`;
  const roles = [...new Set(tasks.map((t) => t.agentRole))];
  const ov = overlaps(intervals, now);
  const shown = events.filter((e) => showTrace || !e.type.startsWith('mozaik.')).slice(-250).reverse();
  const byId = new Map(events.map((e) => [e.id, e]));

  return (
    <div className="stack">
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Activity and trace</h2>
        <div className="row">
          <a className="btn btn-sm" href={`/api/cases/${state.case.id}/trace`} download>
            Download trace JSON
          </a>
          <span className="chip chip-plain" role="status">
            Stream: {connection}
          </span>
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Everything here is read from the persisted event log and the Mozaik runtime’s own loop events: agent, loop id, start and finish times. Nothing is animated on a timer or invented. Prompts, document text and model answers are never shown.
      </p>

      {state.runs.length > 1 ? (
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="run-pick">Run</label>
          <select id="run-pick" value={run?.id} onChange={(e) => setRunId(e.target.value)}>
            {state.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.kind} · {r.status} · {fmtDateTime(r.queuedAt)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {run ? (
        <div className="card">
          <div className="row">
            <StatusChip status={run.status === 'partial' ? 'needs_input' : run.status} label={run.status === 'partial' ? 'Finished with limitations' : undefined} />
            {run.inferenceMode === 'test' ? <span className="chip chip-warn chip-plain">TEST MODE: scripted stand-in, not live AI</span> : <span className="chip chip-info chip-plain">{run.model ?? 'model'}</span>}
            <span className="muted">
              run <span className="mono">{run.id.slice(0, 8)}</span> · {run.kind} · evidence revision {run.evidenceRevision} · {run.modelCalls} model call{run.modelCalls === 1 ? '' : 's'}
            </span>
          </div>
          {run.errorMessage ? <p className="error-text" role="alert" style={{ marginBottom: 0 }}>{run.errorMessage}</p> : null}
          {run.trigger && (run.trigger as { reason?: string }).reason ? <p className="muted" style={{ marginBottom: 0 }}>Trigger: {(run.trigger as { reason?: string }).reason}</p> : null}
        </div>
      ) : (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No run yet.
          </p>
        </div>
      )}

      <div className="row" role="group" aria-label="Activity view">
        <button type="button" className={`btn btn-sm ${view === 'concurrency' ? 'btn-primary' : ''}`} aria-pressed={view === 'concurrency'} onClick={() => setView('concurrency')}>
          Concurrency view
        </button>
        <button type="button" className={`btn btn-sm ${view === 'events' ? 'btn-primary' : ''}`} aria-pressed={view === 'events'} onClick={() => setView('events')}>
          Event list
        </button>
      </div>

      {view === 'concurrency' ? (
        <section aria-labelledby="conc-h">
          <h3 id="conc-h" className="sr-only">
            Concurrency view
          </h3>
          {intervals.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                Agent spans appear here once agents start.
              </p>
            </div>
          ) : (
            <>
              <div className="gantt" role="group" aria-label="Agent execution spans on a common time axis">
                {roles.map((role) => (
                  <div key={role} className="gantt-row">
                    <strong style={{ fontSize: '0.86rem' }}>{ROLE_LABEL[role]}</strong>
                    <div className="gantt-track">
                      {intervals
                        .filter((i) => i.role === role)
                        .map((i) => (
                          <span key={i.task.id}>
                            <span
                              role="img"
                              aria-label={`${ROLE_LABEL[role]}: ${fmtTime(i.task.startedAt)} to ${i.task.finishedAt ? fmtTime(i.task.finishedAt) : 'still running'}, ${i.task.status}`}
                              className={`gantt-bar${i.task.status === 'failed' ? ' failed' : ''}${!i.end ? ' running' : ''}`}
                              style={{ left: pct(i.start), width: wid(i.start, i.end ?? now) }}
                              title={`${i.task.taskLabel}\n${fmtTime(i.task.startedAt)} → ${i.task.finishedAt ? fmtTime(i.task.finishedAt) : 'running'}`}
                            />
                            {i.task.inferenceStartedAt && i.task.inferenceFinishedAt ? (
                              <span
                                aria-hidden="true"
                                className="gantt-bar infer"
                                style={{ left: pct(new Date(i.task.inferenceStartedAt).getTime()), width: wid(new Date(i.task.inferenceStartedAt).getTime(), new Date(i.task.inferenceFinishedAt).getTime()) }}
                              />
                            ) : null}
                          </span>
                        ))}
                    </div>
                  </div>
                ))}
                <div className="muted" style={{ fontSize: '0.78rem', marginTop: 6 }}>
                  Axis: {fmtTime(new Date(t0).toISOString())} → {fmtTime(new Date(t1).toISOString())} ({((t1 - t0) / 1000).toFixed(1)} s). Light bars are agent tasks; dark bars are the model call inside them (from Mozaik’s inference events).
                </div>
              </div>
              <div className="card" style={{ marginTop: 12 }}>
                <h4 style={{ marginTop: 0 }}>Overlap observed</h4>
                {ov.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    No two different agents were running at the same time in this run.
                  </p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
                    {ov.slice(0, 8).map((o, i) => (
                      <li key={i}>
                        {ROLE_LABEL[o.a]} and {ROLE_LABEL[o.b]} ran at the same time for {(o.ms / 1000).toFixed(2)} s <span className="mono muted">(loops {o.loopA?.slice(0, 8) ?? '?'} / {o.loopB?.slice(0, 8) ?? '?'})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="t stackable">
                  <caption className="sr-only">Agent tasks with Mozaik loop ids</caption>
                  <thead>
                    <tr>
                      <th scope="col">Agent</th>
                      <th scope="col">Task</th>
                      <th scope="col">Mozaik loop</th>
                      <th scope="col">Started</th>
                      <th scope="col">Finished</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={t.id}>
                        <td data-label="Agent">{ROLE_LABEL[t.agentRole]}</td>
                        <td data-label="Task">
                          {t.taskLabel}
                          {t.attempt > 1 ? ` (attempt ${t.attempt})` : ''}
                        </td>
                        <td data-label="Loop" className="mono">
                          {t.mozaikLoopId ?? '—'}
                        </td>
                        <td data-label="Started" className="mono">
                          {fmtTime(t.startedAt)}
                        </td>
                        <td data-label="Finished" className="mono">
                          {t.finishedAt ? fmtTime(t.finishedAt) : 'running'}
                        </td>
                        <td data-label="Result">
                          <StatusChip status={t.status === 'completed' ? 'finished' : t.status === 'discarded' ? 'idle' : t.status} label={t.status === 'discarded' ? 'Discarded (stale)' : undefined} /> <span className="muted">{t.resultSummary ?? t.error ?? ''}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : (
        <section aria-labelledby="ev-h">
          <div className="row-between">
            <h3 id="ev-h" style={{ margin: 0 }}>
              Events
            </h3>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={showTrace} onChange={(e) => setShowTrace(e.target.checked)} />
              <span style={{ fontSize: '0.88rem' }}>Include Mozaik loop events</span>
            </label>
          </div>
          <div className="card" style={{ marginTop: 8 }}>
            {shown.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No events yet.
              </p>
            ) : (
              <ul className="feed" aria-live="off">
                {shown.map((e) => {
                  const cause = e.causationId ? byId.get(e.causationId) : null;
                  return (
                    <li key={e.seq}>
                      <span className="mono muted">{fmtTime(e.timestamp)}</span>
                      <strong>{ROLE_LABEL[e.agentId] ?? e.agentId}</strong>
                      <span>
                        <span className="mono muted">{e.type}</span> — {describeEvent(e)}
                        {cause ? <span className="muted"> · because of {cause.type}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="why-h">
        <h3 id="why-h">Why this changed</h3>
        {state.assessments.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              No assessment has been made yet.
            </p>
          </div>
        ) : (
          state.assessments.map((a, i) => {
            const d = (a.changeDiff ?? {}) as { classification?: { from: string; to: string } | null; numbers?: { topic: string; from: string; to: string }[]; revised?: { from: { ref: string; title: string } | null; to: { ref: string; title: string } }[] };
            return (
              <div key={a.version} className="card">
                <div className="row-between">
                  <strong>Assessment v{a.version}</strong>
                  <span className="muted" style={{ fontSize: '0.84rem' }}>
                    evidence revision {a.evidenceRevision} · {fmtDateTime(a.createdAt)}
                  </span>
                </div>
                <p style={{ margin: '4px 0' }}>{ASSESSMENT_CLASS_LABEL[a.classification as keyof typeof ASSESSMENT_CLASS_LABEL] ?? a.classification}</p>
                {a.changeReason ? <p style={{ margin: '4px 0' }}>{a.changeReason}</p> : <p className="muted" style={{ margin: '4px 0' }}>{i === state.assessments.length - 1 ? 'First assessment.' : ''}</p>}
                {d.numbers?.map((n) => (
                  <div key={n.topic} className="muted num" style={{ fontSize: '0.86rem' }}>
                    {n.topic.split(':')[0].replace(/_/g, ' ')}: {n.from} → {n.to}
                  </div>
                ))}
                {d.revised?.map((r) => (
                  <div key={r.to.ref} className="muted" style={{ fontSize: '0.86rem' }}>
                    {r.from?.ref ?? '—'} “{r.from?.title}” → {r.to.ref} “{r.to.title}”
                  </div>
                ))}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
