-- Lets pg_cron start the review generation/grading batches on the knowledge app.
-- The shared token lives in Supabase Vault as 'review_batch_token' and in the
-- Cloudflare secret REVIEW_BATCH_TOKEN; it is never stored in this file.
-- The cron schedules themselves are added when the review screen switches to
-- the queue, so no AI cost is spent on questions nobody can answer yet.
begin;

create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_review_batch(p_kind text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_token text;
begin
  if p_kind not in ('generate', 'grade') then
    raise exception 'invalid review batch kind' using errcode = '22023';
  end if;
  select ds.decrypted_secret into v_token
  from vault.decrypted_secrets ds
  where ds.name = 'review_batch_token';
  if v_token is null or char_length(v_token) < 32 then
    raise warning 'review_batch_token is not configured in Vault';
    return null;
  end if;
  -- The batch can call the AI for a few minutes; wait long enough that the
  -- connection stays open until it finishes.
  return net.http_post(
    url := 'https://knowledge-50b.pages.dev/api/review-batch/' || p_kind,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Review-Batch-Token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
end
$$;

revoke all on function public.trigger_review_batch(text) from public, anon, authenticated;
grant execute on function public.trigger_review_batch(text) to service_role;

commit;
