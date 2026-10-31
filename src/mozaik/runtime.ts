/**
 * The Mozaik runtime for this process. `defineRuntime` returns the runtime functions; `initializeRuntime`
 * may be called only once per module instance, so each investigation runs in its own worker process
 * (workers/run-child.ts) and this module is initialised exactly once there.
 */
import { defineRuntime } from '@mozaik-ai/core';
import { CounterbillState } from './state';

export const { initializeRuntime, resolveRuntime, resolveParticipant, join, leave, sendMessage, sendEvent, runLoop } = defineRuntime<CounterbillState>();

export function state(): CounterbillState {
  return resolveRuntime().state;
}
