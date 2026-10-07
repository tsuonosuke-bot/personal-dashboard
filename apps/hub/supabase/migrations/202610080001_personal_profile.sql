-- 自分の情報（issue #85）。住まい・家電・デバイス・使っているサービスなど、LLMに毎回口頭で説明している
-- 「自分の前提」を1行1項目で置く。knowledge に混ぜると復習の出題に入るので、専用の表にする。
--
-- - 1行は「分類・名前・中身」（例: 家電・洗濯機・パナソニック NA-LX129C）。補足は detail。
-- - 買い替え・引っ越しは行を書き換えず、古い行に until（使わなくなった日）を入れて新しい行を足す。
--   replace_personal_profile が1回で行う。過去の持ち物も「前の〜は？」に答えられるよう残す。
-- - ai_visible = false の行は「AIに渡さない」。チャットのスキル（my-profile）は personal_profile_for_ai
--   だけを読む。Supabase MCP はDB全体を読める権限で動くので、これは取り決めであって権限ではない。
--   本当に渡したくない情報（住所の番地、口座番号、パスワードなど）はそもそも入れない。
-- - ブラウザ（anon）からは読めない。service_role だけ。
begin;

create table if not exists public.personal_profile (
  id bigint generated always as identity primary key,
  category text not null check (category in ('住まい', '家電', 'デバイス', '持ち物', 'サービス', '乗り物', '仕事', '好み・習慣', 'その他')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  value text not null check (char_length(btrim(value)) between 1 and 500),
  detail text check (detail is null or char_length(detail) <= 2000),
  since date,
  until date,
  ai_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (until is null or since is null or until >= since)
);

-- 同じ分類・名前で「今使っているもの」は1つまで（買い替えの取り違えを防ぐ）。
create unique index if not exists personal_profile_current_name_idx
  on public.personal_profile (category, lower(btrim(name)))
  where until is null;

alter table public.personal_profile enable row level security;
revoke all on table public.personal_profile from public, anon, authenticated;
grant select, insert, update, delete on table public.personal_profile to service_role;

comment on table public.personal_profile is
  '自分の情報（#85）。1行1項目。until が入った行は過去のもの（買い替え・引っ越し）。ai_visible=false はAIに渡さない。';
comment on column public.personal_profile.until is '使わなくなった日。nullなら今のもの。';
comment on column public.personal_profile.ai_visible is 'falseならチャットのAIに渡さない（personal_profile_for_ai に出ない）。';

create or replace function public.touch_personal_profile()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists personal_profile_touch on public.personal_profile;
create trigger personal_profile_touch
  before update on public.personal_profile
  for each row execute function public.touch_personal_profile();

-- AIに渡してよい行だけ。今のものを先に、分類・名前の順。
create or replace view public.personal_profile_for_ai
with (security_invoker = true)
as
  select id, category, name, value, detail, since, until, until is null as current, updated_at
    from public.personal_profile
   where ai_visible
   order by until is not null, category, name, since desc nulls last;

revoke all on table public.personal_profile_for_ai from public, anon, authenticated;
grant select on table public.personal_profile_for_ai to service_role;

comment on view public.personal_profile_for_ai is 'チャットのAI（my-profileスキル）が読む自分の情報。ai_visible の行だけ。';

-- 買い替え・引っ越し。今の行を p_since の前日で終え、同じ分類・名前・公開範囲で新しい行を足す。
-- 今の行が無い（初めて登録する）ときは新しい行だけを足す。足した行を返す。
create or replace function public.replace_personal_profile(
  p_category text,
  p_name text,
  p_value text,
  p_detail text default null,
  p_since date default null
)
returns public.personal_profile
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_since date := coalesce(p_since, public.jst_today());
  v_old public.personal_profile;
  v_new public.personal_profile;
begin
  select * into v_old
    from public.personal_profile
   where category = p_category and lower(btrim(name)) = lower(btrim(p_name)) and until is null
   for update;

  if found then
    update public.personal_profile
       set until = greatest(v_since - 1, coalesce(since, v_since - 1))
     where id = v_old.id;
  end if;

  insert into public.personal_profile (category, name, value, detail, since, ai_visible)
  values (p_category, btrim(p_name), btrim(p_value), nullif(btrim(p_detail), ''), v_since, coalesce(v_old.ai_visible, true))
  returning * into v_new;
  return v_new;
end
$$;

revoke all on function public.replace_personal_profile(text, text, text, text, date) from public, anon, authenticated;
grant execute on function public.replace_personal_profile(text, text, text, text, date) to service_role;
revoke all on function public.touch_personal_profile() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
