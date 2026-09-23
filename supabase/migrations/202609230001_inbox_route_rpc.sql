-- Inbox振り分けをDB関数へ集約する（契約: inbox-route-v1）。
-- ダッシュボードとClaude.aiのidea-inboxスキルは、この関数群だけを呼ぶ。
-- 外部作成が必要な出口（calendar）は route_inbox_item で planned を記録し、
-- 呼び出し側がGoogle Calendarへ作成したあと complete_inbox_route / fail_inbox_route で確定する。
begin;

-- 冪等キー。Inboxから作るWant（=振り分け1回）ごとに1つ。既存行はNULLのまま。
alter table public.wants add column if not exists idempotency_key uuid;
create unique index if not exists wants_idempotency_key_key on public.wants (idempotency_key);

create or replace function public.inbox_route_contract()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'contract', 'inbox-route-v1',
    'functions', jsonb_build_array(
      'inbox_route_contract()',
      'route_inbox_item(p_inbox_id bigint, p_exit text, p_params jsonb, p_idempotency_key uuid)',
      'complete_inbox_route(p_idempotency_key uuid, p_target_id text, p_target_url text)',
      'fail_inbox_route(p_idempotency_key uuid, p_error_code text)'
    ),
    'common_params', jsonb_build_object(
      'expected', 'required object {content: text, result?: text|null}. Inbox must be pending and match.'
    ),
    'exits', jsonb_build_object(
      'calendar',       jsonb_build_object('label', '予定',       'completion', 'external', 'intents', jsonb_build_array('act', 'explore'),
                          'required', jsonb_build_array('title', 'calendar'), 'optional', jsonb_build_array('detail', 'intent'),
                          'result', 'Google Calendarへ振り分け'),
      'wish',           jsonb_build_object('label', '欲しいもの', 'completion', 'immediate',
                          'required', jsonb_build_array(), 'optional', jsonb_build_array('content', 'note'),
                          'result', '欲しいものとしてWantsに保存'),
      'writing',        jsonb_build_object('label', '執筆',       'completion', 'immediate', 'intents', jsonb_build_array('explore'),
                          'required', jsonb_build_array('title'), 'optional', jsonb_build_array('detail', 'intent'),
                          'result', 'Writingへ振り分け'),
      'knowledge',      jsonb_build_object('label', '調査',       'completion', 'planned', 'intents', jsonb_build_array('explore'),
                          'required', jsonb_build_array('title'), 'optional', jsonb_build_array('detail', 'intent'),
                          'result', 'Knowledge候補へ振り分け'),
      'habit',          jsonb_build_object('label', '習慣',       'completion', 'immediate', 'intents', jsonb_build_array('continue'),
                          'required', jsonb_build_array('title', 'cadence'), 'optional', jsonb_build_array('detail', 'intent'),
                          'cadences', jsonb_build_array('daily', 'weekdays', 'weekly', 'flexible'),
                          'result', 'Habitsへ振り分け'),
      'focus',          jsonb_build_object('label', 'Focus',      'completion', 'immediate', 'intents', jsonb_build_array('keep'),
                          'required', jsonb_build_array('title'), 'optional', jsonb_build_array('detail', 'intent'),
                          'result', 'Focusへ振り分け'),
      'github',         jsonb_build_object('label', '開発',       'completion', 'planned', 'intents', jsonb_build_array('act'),
                          'required', jsonb_build_array('title'), 'optional', jsonb_build_array('detail', 'intent'),
                          'result', 'GitHub Issueへ振り分け'),
      'journal',        jsonb_build_object('label', '日記',       'completion', 'planned', 'intents', jsonb_build_array('keep'),
                          'required', jsonb_build_array('title'), 'optional', jsonb_build_array('detail', 'intent'),
                          'result', 'Journal候補へ振り分け'),
      'defer',          jsonb_build_object('label', '保留',       'completion', 'immediate',
                          'required', jsonb_build_array('revisit_on'), 'optional', jsonb_build_array('content', 'note'),
                          'result', '保留（再訪 YYYY-MM-DD）'),
      'archive',        jsonb_build_object('label', 'アーカイブ', 'completion', 'immediate', 'intents', jsonb_build_array('discard', 'keep'),
                          'required', jsonb_build_array('title'), 'optional', jsonb_build_array('detail', 'intent'),
                          'result', 'アーカイブへ振り分け'),
      'project_create', jsonb_build_object('label', 'Project（新規）', 'completion', 'immediate',
                          'required', jsonb_build_array('title', 'outcome', 'next_action'), 'optional', jsonb_build_array('theme', 'target_on'),
                          'result', 'Project「<title>」に整理'),
      'project_link',   jsonb_build_object('label', 'Project（既存）', 'completion', 'immediate',
                          'required', jsonb_build_array('project_id', 'project_updated_at'), 'optional', jsonb_build_array(),
                          'result', 'Project「<title>」に整理'),
      'close',          jsonb_build_object('label', 'Inboxクローズ', 'completion', 'immediate',
                          'required', jsonb_build_array(), 'optional', jsonb_build_array(),
                          'result', '(unchanged)')
    ),
    'limits', jsonb_build_object('title', 240, 'detail', 2000, 'content', 2000, 'note', 2000,
                                 'outcome', 2000, 'theme', 120, 'next_action', 500),
    'errors', jsonb_build_array(
      'INBOX_ROUTE_INVALID', 'INBOX_NOT_FOUND', 'INBOX_ROUTE_CONFLICT', 'IDEMPOTENCY_CONFLICT',
      'ROUTE_NOT_FOUND', 'ROUTE_STATE_CONFLICT', 'FOCUS_ACTIVE_LIMIT',
      'PROJECT_CONFLICT', 'PROJECT_NOT_OPEN', 'PROJECT_SOURCE_CONFLICT', 'PROJECT_SOURCE_ALREADY_LINKED'
    )
  );
$$;

-- 文字列パラメータの取り出し。前後空白を除き、空文字はNULL。
create or replace function public.inbox_route_text_param(
  p_params jsonb,
  p_key text,
  p_required boolean,
  p_max integer
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value text;
begin
  if not (p_params ? p_key) or jsonb_typeof(p_params -> p_key) = 'null' then
    v_value := null;
  elsif jsonb_typeof(p_params -> p_key) <> 'string' then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = p_key;
  else
    v_value := nullif(btrim(p_params ->> p_key), '');
  end if;
  if v_value is null and p_required then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = p_key;
  end if;
  if char_length(v_value) > p_max then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = p_key;
  end if;
  return v_value;
end;
$$;

create or replace function public.inbox_route_date_param(p_params jsonb, p_key text, p_required boolean)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  v_text text := public.inbox_route_text_param(p_params, p_key, p_required, 10);
  v_date date;
begin
  if v_text is null then
    return null;
  end if;
  if v_text !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = p_key;
  end if;
  begin
    v_date := v_text::date;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = p_key;
  end;
  if to_char(v_date, 'YYYY-MM-DD') <> v_text then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = p_key;
  end if;
  return v_date;
end;
$$;

-- Google Calendarの予定指定。アプリのparseCalendarScheduleと同じ規則で正規化する。
create or replace function public.inbox_route_calendar_param(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_keys text[];
  v_all_day boolean;
  v_start text;
  v_end text;
  v_time_pattern constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'calendar';
  end if;
  select array_agg(k order by k) into v_keys from jsonb_object_keys(p_value) k;
  if v_keys is distinct from array['allDay', 'date', 'endTime', 'startTime', 'timeZone'] then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'calendar';
  end if;
  if jsonb_typeof(p_value -> 'allDay') <> 'boolean' or p_value ->> 'timeZone' is distinct from 'Asia/Tokyo' then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'calendar';
  end if;
  perform public.inbox_route_date_param(p_value, 'date', true);
  v_all_day := (p_value ->> 'allDay')::boolean;
  if v_all_day then
    if jsonb_typeof(p_value -> 'startTime') <> 'null' or jsonb_typeof(p_value -> 'endTime') <> 'null' then
      raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'calendar';
    end if;
  else
    v_start := p_value ->> 'startTime';
    v_end := p_value ->> 'endTime';
    if jsonb_typeof(p_value -> 'startTime') <> 'string' or jsonb_typeof(p_value -> 'endTime') <> 'string'
       or v_start !~ v_time_pattern or v_end !~ v_time_pattern or v_end <= v_start then
      raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'calendar';
    end if;
  end if;
  return jsonb_build_object(
    'allDay', v_all_day,
    'date', p_value ->> 'date',
    'startTime', case when v_all_day then null else v_start end,
    'endTime', case when v_all_day then null else v_end end,
    'timeZone', 'Asia/Tokyo'
  );
end;
$$;

-- 応答は常にDBの現在値から組み立てる（再送時も同じ形）。
create or replace function public.inbox_route_response(
  p_inbox_id bigint,
  p_exit text,
  p_state text,
  p_replayed boolean,
  p_want_id bigint,
  p_route_id bigint,
  p_project_id bigint
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'contract', 'inbox-route-v1',
    'exit', p_exit,
    'state', p_state,
    'replayed', p_replayed,
    'inbox', (select jsonb_build_object('id', i.id, 'status', i.status, 'result', i.result)
              from public.idea_inbox i where i.id = p_inbox_id),
    'want', (select jsonb_build_object('id', w.id, 'status', w.status, 'type', w.type, 'revisit_on', w.revisit_on)
             from public.wants w where w.id = p_want_id),
    'route', (select jsonb_build_object(
                'id', r.id, 'intent', r.intent, 'destination', r.destination, 'status', r.status,
                'title', r.title, 'detail', r.detail, 'cadence', r.cadence,
                'target_id', r.target_id, 'target_url', r.target_url, 'error_code', r.error_code,
                'destination_data', r.destination_data, 'idempotency_key', r.idempotency_key)
              from public.want_routes r where r.id = p_route_id),
    'project_id', p_project_id
  );
$$;

create or replace function public.route_inbox_item(
  p_inbox_id bigint,
  p_exit text,
  p_params jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_allowed_keys text[];
  v_route_exit boolean := false;
  v_destination text;
  v_intents text[];
  v_intent text;
  v_title text;
  v_detail text;
  v_cadence text;
  v_calendar jsonb;
  v_destination_data jsonb := '{}'::jsonb;
  v_content text;
  v_note text;
  v_revisit_on date;
  v_outcome text;
  v_theme text;
  v_target_on date;
  v_next_action text;
  v_project_id bigint;
  v_project_updated_at timestamptz;
  v_expected jsonb;
  v_expected_content text;
  v_has_expected_result boolean;
  v_expected_result text;
  v_inbox public.idea_inbox%rowtype;
  v_want public.wants%rowtype;
  v_route public.want_routes%rowtype;
  v_target_id text;
  v_target_url text;
  v_label text;
  v_existing_project_id bigint;
  v_existing_project_title text;
  v_existing_treatment text;
begin
  if p_inbox_id is null or p_inbox_id <= 0 then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'p_inbox_id';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'p_idempotency_key';
  end if;
  if jsonb_typeof(v_params) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'p_params';
  end if;

  -- 出口ごとの許可キーと振り分け先
  case p_exit
    when 'calendar' then
      v_route_exit := true; v_destination := 'calendar'; v_intents := array['act', 'explore'];
      v_label := 'Google Calendar';
      v_allowed_keys := array['expected', 'title', 'detail', 'intent', 'calendar'];
    when 'github' then
      v_route_exit := true; v_destination := 'github'; v_intents := array['act']; v_label := 'GitHub Issue';
    when 'writing' then
      v_route_exit := true; v_destination := 'writing'; v_intents := array['explore']; v_label := 'Writing';
    when 'knowledge' then
      v_route_exit := true; v_destination := 'knowledge'; v_intents := array['explore']; v_label := 'Knowledge候補';
    when 'habit' then
      v_route_exit := true; v_destination := 'habit'; v_intents := array['continue']; v_label := 'Habits';
      v_allowed_keys := array['expected', 'title', 'detail', 'intent', 'cadence'];
    when 'focus' then
      v_route_exit := true; v_destination := 'focus'; v_intents := array['keep']; v_label := 'Focus';
    when 'journal' then
      v_route_exit := true; v_destination := 'journal'; v_intents := array['keep']; v_label := 'Journal候補';
    when 'archive' then
      v_route_exit := true; v_destination := 'archive'; v_intents := array['discard', 'keep']; v_label := 'アーカイブ';
    when 'wish' then
      v_allowed_keys := array['expected', 'content', 'note'];
    when 'defer' then
      v_allowed_keys := array['expected', 'content', 'note', 'revisit_on'];
    when 'project_create' then
      v_allowed_keys := array['expected', 'title', 'outcome', 'theme', 'target_on', 'next_action'];
    when 'project_link' then
      v_allowed_keys := array['expected', 'project_id', 'project_updated_at'];
    when 'close' then
      v_allowed_keys := array['expected'];
    else
      raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'p_exit';
  end case;
  if v_route_exit and v_allowed_keys is null then
    v_allowed_keys := array['expected', 'title', 'detail', 'intent'];
  end if;
  if exists (select 1 from jsonb_object_keys(v_params) k where k <> all (v_allowed_keys)) then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'p_params';
  end if;

  -- 楽観ロック用の期待値
  v_expected := v_params -> 'expected';
  if v_expected is null or jsonb_typeof(v_expected) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_expected) k where k not in ('content', 'result'))
     or jsonb_typeof(v_expected -> 'content') is distinct from 'string' then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'expected';
  end if;
  v_expected_content := v_expected ->> 'content';
  v_has_expected_result := v_expected ? 'result';
  if v_has_expected_result and jsonb_typeof(v_expected -> 'result') not in ('string', 'null') then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'expected';
  end if;
  v_expected_result := v_expected ->> 'result';

  -- 形式の検証（日付の今日以降チェックは状態確認の後）
  if v_route_exit then
    v_title := public.inbox_route_text_param(v_params, 'title', true, 240);
    v_detail := public.inbox_route_text_param(v_params, 'detail', false, 2000);
    v_intent := coalesce(public.inbox_route_text_param(v_params, 'intent', false, 16), v_intents[1]);
    if v_intent <> all (v_intents) then
      raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'intent';
    end if;
    if v_destination = 'habit' then
      v_cadence := public.inbox_route_text_param(v_params, 'cadence', true, 16);
      if v_cadence not in ('daily', 'weekdays', 'weekly', 'flexible') then
        raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'cadence';
      end if;
    end if;
    if v_destination = 'calendar' then
      v_calendar := public.inbox_route_calendar_param(v_params -> 'calendar');
      v_destination_data := jsonb_build_object('calendar', v_calendar);
    end if;
  elsif p_exit in ('wish', 'defer') then
    v_content := public.inbox_route_text_param(v_params, 'content', false, 2000);
    v_note := public.inbox_route_text_param(v_params, 'note', false, 2000);
    if p_exit = 'defer' then
      v_revisit_on := public.inbox_route_date_param(v_params, 'revisit_on', true);
    end if;
  elsif p_exit = 'project_create' then
    v_title := public.inbox_route_text_param(v_params, 'title', true, 240);
    v_outcome := public.inbox_route_text_param(v_params, 'outcome', true, 2000);
    v_theme := public.inbox_route_text_param(v_params, 'theme', false, 120);
    v_target_on := public.inbox_route_date_param(v_params, 'target_on', false);
    v_next_action := public.inbox_route_text_param(v_params, 'next_action', true, 500);
  elsif p_exit = 'project_link' then
    if jsonb_typeof(v_params -> 'project_id') is distinct from 'number'
       or (v_params ->> 'project_id') !~ '^[1-9][0-9]{0,17}$' then
      raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'project_id';
    end if;
    v_project_id := (v_params ->> 'project_id')::bigint;
    begin
      v_project_updated_at := public.inbox_route_text_param(v_params, 'project_updated_at', true, 64)::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'project_updated_at';
    end;
  end if;

  select * into v_inbox from public.idea_inbox where id = p_inbox_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'INBOX_NOT_FOUND';
  end if;

  -- 再送判定（Wantを作る出口）: 同じキーのWantがあれば、同じ要求かを確かめて前回の結果を返す。
  select * into v_want from public.wants where idempotency_key = p_idempotency_key for update;
  if found then
    if v_want.source_inbox_id is distinct from p_inbox_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    select * into v_route from public.want_routes where idempotency_key = p_idempotency_key for update;
    if p_exit in ('wish', 'defer') then
      if v_route.id is not null
         or v_want.content <> coalesce(v_content, v_inbox.content)
         or v_want.note is distinct from v_note
         or (p_exit = 'wish' and (v_want.type <> 'wish' or v_want.revisit_on is not null))
         or (p_exit = 'defer' and (v_want.type <> 'want' or v_want.revisit_on is distinct from v_revisit_on)) then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
      end if;
      return public.inbox_route_response(p_inbox_id, p_exit, 'completed', true, v_want.id, null, null);
    end if;
    if not v_route_exit or v_route.id is null
       or v_route.want_id <> v_want.id
       or v_route.destination <> v_destination
       or v_route.intent <> v_intent
       or v_route.title <> v_title
       or v_route.detail is distinct from v_detail
       or v_route.cadence is distinct from v_cadence
       or v_route.destination_data <> v_destination_data then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    if v_route.status = 'cancelled' then
      raise exception using errcode = 'P0001', message = 'ROUTE_STATE_CONFLICT';
    end if;
    if v_destination = 'calendar' and v_route.status <> 'created' then
      if v_route.status = 'failed' then
        update public.want_routes
        set status = 'planned', error_code = null, updated_at = now()
        where id = v_route.id;
      end if;
      return public.inbox_route_response(p_inbox_id, p_exit, 'awaiting_external', true, v_want.id, v_route.id, null);
    end if;
    return public.inbox_route_response(p_inbox_id, p_exit, 'completed', true, v_want.id, v_route.id, null);
  end if;

  -- 再送判定（Project）: 既にこのInboxがProjectへ入っていれば、同じ要求のときだけ成功扱い。
  if p_exit in ('project_create', 'project_link') then
    select pi.project_id, p.title, pi.treatment
    into v_existing_project_id, v_existing_project_title, v_existing_treatment
    from public.project_items pi
    join public.projects p on p.id = pi.project_id
    where pi.source_type = 'inbox' and pi.source_id = p_inbox_id;
    if found then
      if (p_exit = 'project_link' and v_existing_project_id = v_project_id and v_existing_treatment = 'unprocessed')
         or (p_exit = 'project_create' and v_existing_project_title = v_title and v_existing_treatment = 'action_source') then
        return public.inbox_route_response(p_inbox_id, p_exit, 'completed', true, null, null, v_existing_project_id);
      end if;
      raise exception using errcode = 'P0001', message = 'PROJECT_SOURCE_ALREADY_LINKED';
    end if;
  end if;

  -- 再送判定（クローズ）: 既に整理済みで内容が期待どおりなら成功扱い。
  if p_exit = 'close' and v_inbox.status = 'done' and v_inbox.content = v_expected_content
     and (not v_has_expected_result or v_inbox.result is not distinct from v_expected_result) then
    return public.inbox_route_response(p_inbox_id, p_exit, 'completed', true, null, null, null);
  end if;

  -- 楽観ロック
  if v_inbox.status <> 'pending' or v_inbox.content <> v_expected_content
     or (v_has_expected_result and v_inbox.result is distinct from v_expected_result) then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_CONFLICT';
  end if;
  if p_exit = 'defer' and v_revisit_on < public.jst_today() then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'revisit_on';
  end if;

  if p_exit = 'close' then
    update public.idea_inbox set status = 'done' where id = p_inbox_id;
    return public.inbox_route_response(p_inbox_id, p_exit, 'completed', false, null, null, null);
  end if;

  if p_exit = 'project_create' then
    v_project_id := public.create_project_from_source(
      'inbox', p_inbox_id, v_inbox.content, v_inbox.status, v_inbox.result,
      v_title, v_outcome, v_theme, v_target_on, v_next_action
    );
    return public.inbox_route_response(p_inbox_id, p_exit, 'completed', false, null, null, v_project_id);
  end if;

  if p_exit = 'project_link' then
    v_project_id := public.link_project_source(
      v_project_id, v_project_updated_at,
      'inbox', p_inbox_id, v_inbox.content, v_inbox.status, v_inbox.result
    );
    return public.inbox_route_response(p_inbox_id, p_exit, 'completed', false, null, null, v_project_id);
  end if;

  if p_exit in ('wish', 'defer') then
    insert into public.wants (content, status, type, revisit_on, note, source_inbox_id, idempotency_key)
    values (
      coalesce(v_content, v_inbox.content), 'active',
      case when p_exit = 'wish' then 'wish' else 'want' end,
      v_revisit_on, v_note, p_inbox_id, p_idempotency_key
    )
    returning * into v_want;
    update public.idea_inbox
    set status = 'done',
        result = case when p_exit = 'wish' then '欲しいものとしてWantsに保存'
                      else format('保留（再訪 %s）', to_char(v_revisit_on, 'YYYY-MM-DD')) end
    where id = p_inbox_id;
    return public.inbox_route_response(p_inbox_id, p_exit, 'completed', false, v_want.id, null, null);
  end if;

  -- 振り分け先を持つ出口: 履歴用Want → want_routes → 内部登録
  insert into public.wants (content, status, type, source_inbox_id, idempotency_key)
  values (v_inbox.content, 'active', 'want', p_inbox_id, p_idempotency_key)
  returning * into v_want;

  insert into public.want_routes (
    want_id, intent, destination, status, title, detail, cadence, destination_data, idempotency_key
  ) values (
    v_want.id, v_intent, v_destination, 'planned', v_title, v_detail, v_cadence, v_destination_data, p_idempotency_key
  )
  returning * into v_route;

  if v_destination = 'calendar' then
    -- 外部作成待ち。Inboxは未整理のまま。complete_inbox_route で確定する。
    return public.inbox_route_response(p_inbox_id, p_exit, 'awaiting_external', false, v_want.id, v_route.id, null);
  end if;

  if v_destination = 'writing' then
    insert into public.writing_topics (source_route_id, source_want_id, title, question, status)
    values (v_route.id, v_want.id, v_title, v_detail, 'candidate')
    returning id::text into v_target_id;
    v_target_url := '/writing/?id=' || v_target_id;
  elsif v_destination = 'habit' then
    insert into public.habits (source_route_id, source_want_id, name, purpose, cadence, status)
    values (v_route.id, v_want.id, v_title, v_detail, v_cadence, 'active')
    returning id::text into v_target_id;
  elsif v_destination = 'focus' then
    insert into public.focus_items (source_route_id, source_want_id, content, note, status)
    values (v_route.id, v_want.id, v_title, v_detail, 'active')
    returning id::text into v_target_id;
  elsif v_destination = 'archive' then
    v_target_id := 'want:' || v_want.id;
  end if;

  if v_target_id is not null then
    update public.want_routes
    set status = 'created', target_id = v_target_id, target_url = v_target_url, error_code = null, updated_at = now()
    where id = v_route.id;
  end if;
  -- github / knowledge / journal は planned のまま（complete_want_after_route がWantを完了する）。

  update public.idea_inbox
  set status = 'done', result = v_label || 'へ振り分け'
  where id = p_inbox_id;

  return public.inbox_route_response(p_inbox_id, p_exit, 'completed', false, v_want.id, v_route.id, null);
end;
$$;

-- 外部作成（Google Calendar）の成功を確定する。
create or replace function public.complete_inbox_route(
  p_idempotency_key uuid,
  p_target_id text,
  p_target_url text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_route public.want_routes%rowtype;
  v_inbox_id bigint;
  v_target_id text := nullif(btrim(p_target_id), '');
  v_target_url text := nullif(btrim(p_target_url), '');
begin
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'p_idempotency_key';
  end if;
  if v_target_id is null or char_length(v_target_id) > 1024 then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'p_target_id';
  end if;
  if char_length(v_target_url) > 2048 then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'p_target_url';
  end if;

  select w.source_inbox_id into v_inbox_id
  from public.want_routes r
  join public.wants w on w.id = r.want_id
  where r.idempotency_key = p_idempotency_key;
  if v_inbox_id is null then
    raise exception using errcode = 'P0001', message = 'ROUTE_NOT_FOUND';
  end if;

  -- route_inbox_item と同じ順（Inbox → Route）でロックする。
  perform 1 from public.idea_inbox where id = v_inbox_id for update;
  select * into v_route from public.want_routes where idempotency_key = p_idempotency_key for update;

  if v_route.destination <> 'calendar' or v_route.status = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'ROUTE_STATE_CONFLICT';
  end if;
  if v_route.status = 'created' then
    if v_route.target_id is distinct from v_target_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
    end if;
    return public.inbox_route_response(v_inbox_id, 'calendar', 'completed', true, v_route.want_id, v_route.id, null);
  end if;

  update public.want_routes
  set status = 'created', target_id = v_target_id, target_url = v_target_url, error_code = null, updated_at = now()
  where id = v_route.id;
  -- Wantの完了とscheduled_actionsの作成は既存トリガーが行う。

  update public.idea_inbox
  set status = 'done', result = 'Google Calendarへ振り分け'
  where id = v_inbox_id and status = 'pending';

  return public.inbox_route_response(v_inbox_id, 'calendar', 'completed', false, v_route.want_id, v_route.id, null);
end;
$$;

-- 外部作成の失敗を記録する。Inboxは未整理のまま残り、同じキーで route_inbox_item を再送すると再試行できる。
create or replace function public.fail_inbox_route(
  p_idempotency_key uuid,
  p_error_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_route public.want_routes%rowtype;
  v_inbox_id bigint;
begin
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'p_idempotency_key';
  end if;
  if p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception using errcode = 'P0001', message = 'INBOX_ROUTE_INVALID', detail = 'p_error_code';
  end if;

  select w.source_inbox_id into v_inbox_id
  from public.want_routes r
  join public.wants w on w.id = r.want_id
  where r.idempotency_key = p_idempotency_key;
  if v_inbox_id is null then
    raise exception using errcode = 'P0001', message = 'ROUTE_NOT_FOUND';
  end if;

  perform 1 from public.idea_inbox where id = v_inbox_id for update;
  select * into v_route from public.want_routes where idempotency_key = p_idempotency_key for update;

  if v_route.destination <> 'calendar' or v_route.status not in ('planned', 'failed') then
    raise exception using errcode = 'P0001', message = 'ROUTE_STATE_CONFLICT';
  end if;

  update public.want_routes
  set status = 'failed', error_code = p_error_code, updated_at = now()
  where id = v_route.id;

  return public.inbox_route_response(v_inbox_id, 'calendar', 'failed', false, v_route.want_id, v_route.id, null);
end;
$$;

revoke all on function public.inbox_route_contract() from public, anon, authenticated;
revoke all on function public.inbox_route_text_param(jsonb, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.inbox_route_date_param(jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.inbox_route_calendar_param(jsonb) from public, anon, authenticated;
revoke all on function public.inbox_route_response(bigint, text, text, boolean, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.route_inbox_item(bigint, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.complete_inbox_route(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fail_inbox_route(uuid, text) from public, anon, authenticated;

grant execute on function public.inbox_route_contract() to service_role;
grant execute on function public.inbox_route_text_param(jsonb, text, boolean, integer) to service_role;
grant execute on function public.inbox_route_date_param(jsonb, text, boolean) to service_role;
grant execute on function public.inbox_route_calendar_param(jsonb) to service_role;
grant execute on function public.inbox_route_response(bigint, text, text, boolean, bigint, bigint, bigint) to service_role;
grant execute on function public.route_inbox_item(bigint, text, jsonb, uuid) to service_role;
grant execute on function public.complete_inbox_route(uuid, text, text) to service_role;
grant execute on function public.fail_inbox_route(uuid, text) to service_role;

insert into public.dashboard_schema_versions (app_id, migration, updated_at)
values ('personal-dashboard', '202609230001_inbox_route_rpc', now())
on conflict (app_id) do update
set migration = excluded.migration,
    updated_at = excluded.updated_at;

notify pgrst, 'reload schema';

commit;
