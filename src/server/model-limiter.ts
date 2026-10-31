/**
 * Pacing shared by every worker process that uses the same API key. A free-tier key has one quota however many
 * investigations are running, so the per-minute counter lives in PostgreSQL (the `rate_limits` table), not in a
 * process. Fixed one-minute windows: simple and cross-process; the provider's own 429 handling covers the rest.
 */
import { one } from '@/db/pool';

export async function acquireModelSlot(key: string, requestsPerMinute: number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<{ waitedMs: number }> {
  if (requestsPerMinute <= 0) return { waitedMs: 0 };
  let waited = 0;
  for (;;) {
    const row = await one<{ count: number; ms_left: number; window_start: Date }>(
      `insert into rate_limits(key, window_start, count) values ($1, to_timestamp(floor(extract(epoch from now()) / 60) * 60), 1)
       on conflict (key, window_start) do update set count = rate_limits.count + 1
       returning count, window_start, (extract(epoch from (window_start + interval '60 seconds' - now())) * 1000)::int as ms_left`,
      [key],
    );
    if (row!.count <= requestsPerMinute) return { waitedMs: waited };
    // Over the window's allowance: give the slot back and wait for the next window to open.
    await one('update rate_limits set count = count - 1 where key = $1 and window_start = $2 returning count', [key, row!.window_start]);
    const wait = Math.max(100, row!.ms_left + 50);
    waited += wait;
    await sleep(wait);
  }
}
