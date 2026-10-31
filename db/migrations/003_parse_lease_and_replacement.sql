-- Parsing is claimed with a lease, so a document whose parser was interrupted (restart, crash) is retried instead of
-- staying 'parsing' forever and blocking the case. Attempts are counted so a document that keeps killing the parser fails.
alter table documents add column if not exists parse_lease_expires_at timestamptz;
alter table documents add column if not exists parse_attempts integer not null default 0;
-- Set on a document once a replacement (a newer version that supersedes it) has been parsed successfully.
alter table documents add column if not exists superseded_by_ref text;
