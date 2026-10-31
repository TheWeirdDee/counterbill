-- The worker supervisor reports that it is alive, so readiness can say whether anything is there to run investigations.
create table if not exists worker_heartbeats (
  worker_id text primary key,
  last_seen timestamptz not null default now(),
  running_runs int not null default 0,
  max_runs int not null default 0
);
