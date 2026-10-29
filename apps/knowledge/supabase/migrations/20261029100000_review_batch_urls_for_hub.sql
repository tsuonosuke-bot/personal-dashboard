-- Hub・Knowledge・Financeを1つのPagesプロジェクトにまとめた後の、pg_cronの呼び出し先。
-- Knowledgeのバッチ（生成・採点・embedding）は /knowledge/api/... で受ける。
-- 旧URL（knowledge-50b.pages.dev）は、旧Knowledgeプロジェクトを止める時点で使えなくなる。
-- Cloudflareの切り替え（Hubの新しいビルドが本番に出て、REVIEW_BATCH_TOKEN が設定された後）に適用する。
-- トークンは変えない（Vaultの review_batch_token と Cloudflareの REVIEW_BATCH_TOKEN は同じ値）。
begin;

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
    url := 'https://personal-dashboard-7md.pages.dev/knowledge/api/review-batch/' || p_kind,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Review-Batch-Token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
end
$$;

create or replace function public.trigger_embedding_batch()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_token text;
begin
  select ds.decrypted_secret into v_token
  from vault.decrypted_secrets ds
  where ds.name = 'review_batch_token';
  if v_token is null or char_length(v_token) < 32 then
    raise warning 'review_batch_token is not configured in Vault';
    return null;
  end if;
  return net.http_post(
    url := 'https://personal-dashboard-7md.pages.dev/knowledge/api/embedding-batch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Review-Batch-Token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
end
$$;

revoke all on function public.trigger_review_batch(text) from public, anon, authenticated;
revoke all on function public.trigger_embedding_batch() from public, anon, authenticated;
grant execute on function public.trigger_review_batch(text) to service_role;
grant execute on function public.trigger_embedding_batch() to service_role;

commit;
