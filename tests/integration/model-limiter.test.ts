import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupDb, teardownDb } from './helpers';
import { acquireModelSlot } from '@/server/model-limiter';

beforeAll(setupDb);
afterAll(teardownDb);

describe('shared model pacing (one API key = one quota across all runs and workers)', () => {
  it('admits up to the per-minute allowance immediately and makes the rest wait for the next window', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    // Four "workers" ask at once with an allowance of 3 per minute: three pass at once; the fourth sleeps until the window turns.
    // (The sleep is injected as a no-op that rolls the window forward by re-reading time, so we assert on the recorded waits.)
    const key = `model:test-${Math.random()}`;
    const results = await Promise.all([1, 2, 3].map(() => acquireModelSlot(key, 3, sleep)));
    expect(results.every((r) => r.waitedMs === 0)).toBe(true);
    expect(waits).toEqual([]);
    const fourth = acquireModelSlot(key, 3, async (ms) => {
      waits.push(ms);
      throw new Error('stop-after-first-wait'); // proves it had to wait, without sleeping a real minute
    });
    await expect(fourth).rejects.toThrow('stop-after-first-wait');
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(0);
    expect(waits[0]).toBeLessThanOrEqual(60_100);
  });

  it('does nothing when pacing is off', async () => {
    expect((await acquireModelSlot('model:off', 0)).waitedMs).toBe(0);
  });
});
