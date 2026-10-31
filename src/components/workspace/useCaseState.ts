'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaseState } from '@/server/case-state';
import { api, type ApiFail } from '../ui';

export interface StreamEvent {
  seq: number;
  id: string;
  runId: string | null;
  agentId: string;
  type: string;
  timestamp: string;
  evidenceRevision: number;
  causationId: string | null;
  payload: Record<string, unknown>;
}

export type Connection = 'connecting' | 'live' | 'reconnecting';

const ROLE_LABEL: Record<string, string> = { evidence: 'Evidence Agent', billing: 'Billing Agent', contract: 'Contract Agent', timeline: 'Timeline Agent', case: 'Case Agent', drafting: 'Drafting Agent' };

function announceFor(e: StreamEvent): string | null {
  const who = ROLE_LABEL[e.agentId] ?? 'System';
  const p = e.payload as { label?: string; summary?: string; message?: string };
  switch (e.type) {
    case 'agent.started':
      return `${who} started: ${p.label ?? ''}`;
    case 'agent.completed':
      return `${who} finished. ${p.summary ?? ''}`;
    case 'agent.failed':
      return `${who} failed. ${p.message ?? ''}`;
    case 'assessment.updated':
      return 'The case assessment was updated.';
    case 'draft.updated':
      return 'The letter draft was updated.';
    case 'run.completed':
      return 'The investigation finished.';
    case 'run.failed':
      return 'The investigation could not finish.';
    default:
      return null;
  }
}

/**
 * Loads the case read-model and keeps it current from the durable event stream.
 * Events are de-duplicated and ordered by sequence; every relevant event triggers a (debounced) re-read of the
 * server's snapshot, so after any disconnect the UI converges on exactly the stored state.
 */
export function useCaseState(caseId: string) {
  const [state, setState] = useState<CaseState | null>(null);
  const [error, setError] = useState<ApiFail | null>(null);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [announcement, setAnnouncement] = useState('');
  const maxSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventAt = useRef(0);
  const stateRef = useRef<CaseState | null>(null);

  const refetch = useCallback(async () => {
    const res = await api<CaseState>(`/api/cases/${caseId}`, { cache: 'no-store' });
    if (res.ok) {
      stateRef.current = res.data;
      setState(res.data);
      setError(null);
    } else if (!stateRef.current) setError(res.error);
    else if (res.error.code === 'offline') setConnection('reconnecting');
    return res.ok;
  }, [caseId]);

  const scheduleRefetch = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refetch(), 180);
  }, [refetch]);

  useEffect(() => {
    lastEventAt.current = Date.now();
    void refetch();
  }, [refetch]);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    function open() {
      es = new EventSource(`/api/cases/${caseId}/events?after=${maxSeq.current}`);
      es.onopen = () => setConnection('live');
      es.addEventListener('case_event', (m) => {
        const ev = JSON.parse((m as MessageEvent).data) as StreamEvent;
        lastEventAt.current = Date.now();
        if (ev.seq <= maxSeq.current) return; // replay overlap after a reconnect: ignore duplicates
        maxSeq.current = ev.seq;
        setEvents((cur) => (cur.length > 900 ? [...cur.slice(-700), ev] : [...cur, ev]));
        const a = announceFor(ev);
        if (a) setAnnouncement(a);
        if (ev.type !== 'mozaik.inference.started' && ev.type !== 'mozaik.model.answer') scheduleRefetch();
        else scheduleRefetch();
      });
      es.onerror = () => {
        setConnection('reconnecting');
        // The browser retries on its own with Last-Event-ID; if the stream is CLOSED, reopen with our cursor.
        if (es && es.readyState === EventSource.CLOSED && !closed) {
          es.close();
          setTimeout(() => !closed && open(), 1500);
        }
      };
    }
    open();
    return () => {
      closed = true;
      es?.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [caseId, scheduleRefetch]);

  // Safety net: if a run is active but nothing arrived for a while, re-read the snapshot.
  useEffect(() => {
    const t = setInterval(() => {
      const s = stateRef.current;
      if (s?.activeRun && Date.now() - lastEventAt.current > 12000) void refetch();
    }, 6000);
    const vis = () => document.visibilityState === 'visible' && void refetch();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('online', vis);
    };
  }, [refetch]);

  return { state, error, events, connection, announcement, refetch };
}
