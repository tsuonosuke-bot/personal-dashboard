-- PostgREST's on_conflict=google_event_id emits ON CONFLICT (google_event_id)
-- without an index predicate, so the partial unique index from
-- 202610180001 could not arbiter it (HTTP 400). A plain unique index works the
-- same: Postgres treats NULLs as distinct, so Dashboard-routed rows stay valid.

drop index if exists public.scheduled_actions_google_event_id_key;
create unique index scheduled_actions_google_event_id_key on public.scheduled_actions (google_event_id);
