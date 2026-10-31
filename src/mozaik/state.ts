/**
 * Shared runtime state for ONE investigation run of ONE case.
 *
 * This is an application extension of Mozaik's `RuntimeState` (which only carries the participant registry).
 * Mozaik does not persist it; PostgreSQL is the source of truth and this is materialised from it when the run
 * starts and refreshed after each committed write. One worker process hosts exactly one such state.
 */
import { RuntimeState } from '@mozaik-ai/core';
import type { AgentRole } from '@/domain/schemas';
import type { FactRow, FindingRow, QuestionRow } from '@/db/repo';

export type AgentStatusValue = 'idle' | 'queued' | 'investigating' | 'revising' | 'finished' | 'needs_input' | 'failed';

export interface AgentStatus {
  status: AgentStatusValue;
  activeTasks: number;
  completedTasks: number;
  invocations: number;
  lastSummary: string | null;
  lastError: string | null;
}

export class CounterbillState extends RuntimeState {
  caseId!: string;
  runId!: string;
  /** Evidence revision this run was launched for. Results computed against an older revision are discarded. */
  evidenceRevision = 0;
  phase: 'investigating' | 'needs_input' | 'review_ready' | 'failed' | 'cancelled' = 'investigating';
  inferenceMode: 'live' | 'test' = 'live';
  model = '';
  /** Roles this run was asked to re-evaluate; empty means "all first-wave agents" (a fresh start). */
  targeted: AgentRole[] = [];

  facts = new Map<string, FactRow>();
  findings = new Map<string, FindingRow>();
  questions = new Map<string, QuestionRow>();
  agentStatus = new Map<AgentRole, AgentStatus>();
  /** role -> Mozaik/application event ids already handled by that role (idempotent event handling). */
  lastProcessed = new Map<string, Set<string>>();
  assessmentVersion = 0;
  draftVersion = 0;

  // Coordination bookkeeping
  participantIds = new Map<string, string>();
  inFlight = new Set<string>();
  timers = new Map<string, NodeJS.Timeout>();
  cancelled = false;
  failedRoles = new Set<AgentRole>();
  duplicateEventsDropped = 0;
  staleResultsDiscarded = 0;
  /** Signature of the inputs each role last processed, so it only re-runs when something relevant changed. */
  inputSignature = new Map<string, string>();

  status(role: AgentRole): AgentStatus {
    let s = this.agentStatus.get(role);
    if (!s) {
      s = { status: 'idle', activeTasks: 0, completedTasks: 0, invocations: 0, lastSummary: null, lastError: null };
      this.agentStatus.set(role, s);
    }
    return s;
  }

  hasProcessed(role: string, eventId: string): boolean {
    return this.lastProcessed.get(role)?.has(eventId) ?? false;
  }
  markProcessed(role: string, eventId: string): void {
    let set = this.lastProcessed.get(role);
    if (!set) {
      set = new Set();
      this.lastProcessed.set(role, set);
    }
    set.add(eventId);
  }
}
