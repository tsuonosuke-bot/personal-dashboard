-- #233: Save an Inbox memo through the existing SF6 models and complete its
-- source in the same transaction. Immutable request/ID snapshots survive deletes.
begin;

create table public.inbox_sf6_routes (
  idempotency_key uuid primary key,
  inbox_id bigint unique references public.idea_inbox(id) on delete set null,
  source_inbox_id_snapshot bigint not null unique check (source_inbox_id_snapshot > 0),
  resource text not null check (resource in ('situations','sequences','drills')),
  situation_id bigint references public.sf6_situations(id) on delete set null,
  sequence_id bigint references public.sf6_sequences(id) on delete set null,
  drill_id bigint references public.sf6_drills(id) on delete set null,
  target_id_snapshot bigint not null check (target_id_snapshot > 0),
  source_content text not null,
  source_result text,
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  created_at timestamptz not null default now(),
  check ((resource = 'situations' or situation_id is null)
    and (resource = 'sequences' or sequence_id is null)
    and (resource = 'drills' or drill_id is null)),
  check (num_nonnulls(situation_id,sequence_id,drill_id) <= 1)
);
create index inbox_sf6_routes_target_idx on public.inbox_sf6_routes(resource,target_id_snapshot);
alter table public.inbox_sf6_routes enable row level security;
revoke all on table public.inbox_sf6_routes from public, anon, authenticated;
grant select, insert on table public.inbox_sf6_routes to service_role;

-- Validate JSON before casts or jsonb_populate_record. In particular, that
-- function silently ignores unknown columns, so it is never the validator.
create function public.inbox_sf6_valid_ref(p_ref jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare v_state jsonb; v_number numeric;
begin
  if jsonb_typeof(p_ref) = 'number' then
    v_number := (p_ref #>> '{}')::numeric;
    return v_number = trunc(v_number) and v_number between 1 and 9007199254740991;
  end if;
  if jsonb_typeof(p_ref) is distinct from 'object' or p_ref - 'state' <> '{}' then return false; end if;
  v_state := p_ref -> 'state';
  if jsonb_typeof(v_state) is distinct from 'object'
    or v_state - array['advantage','position','recovery','name'] <> '{}'
    or jsonb_typeof(v_state -> 'advantage') is distinct from 'number' then return false; end if;
  v_number := (v_state ->> 'advantage')::numeric;
  if v_number <> trunc(v_number) or v_number not between -99 and 300 then return false; end if;
  if v_state ? 'position' and (jsonb_typeof(v_state->'position') <> 'string' or v_state->>'position' not in ('anywhere','midscreen','corner')) then return false; end if;
  if v_state ? 'recovery' and jsonb_typeof(v_state->'recovery') <> 'null'
    and (jsonb_typeof(v_state->'recovery') <> 'string' or v_state->>'recovery' not in ('back_roll','no_back_roll','none')) then return false; end if;
  if v_state ? 'name' and jsonb_typeof(v_state->'name') <> 'null'
    and (jsonb_typeof(v_state->'name') <> 'string' or char_length(v_state->>'name') > 60) then return false; end if;
  return true;
end;
$$;

create function public.inbox_sf6_validate_payload(p_resource text,p_payload jsonb) returns void
language plpgsql set search_path = public as $$
declare
  v_schema jsonb; v_row jsonb; v_field record; v_rule jsonb; v_value jsonb;
  v_number numeric; v_ref jsonb; v_result jsonb; v_seen text[] := '{}'; v_key text;
begin
  if p_resource not in ('situations','sequences','drills') or p_resource is null
    or jsonb_typeof(p_payload) is distinct from 'object'
    or not (p_payload ?& array['row','starts','results'])
    or p_payload - array['row','starts','results'] <> '{}'
    or jsonb_typeof(p_payload->'row') is distinct from 'object' then raise exception 'INBOX_ROUTE_INVALID'; end if;
  v_row := p_payload->'row';
  -- [type, nullable, minimum/length, maximum, optional]. Enum has its list in slot 2.
  v_schema := case p_resource
    when 'situations' then '{"character":["text",true,40],"kind":["enum",false,["trigger","state"]],"name":["text",false,60],"advantage":["int",true,-99,300],"position":["enum",false,["anywhere","midscreen","corner"]],"recovery":["enum",true,["back_roll","no_back_roll","none"]],"memo":["text",true,2000],"archived":["bool",false]}'::jsonb
    when 'sequences' then '{"kind":["enum",false,["combo","setplay"]],"character":["text",false,40],"title":["text",false,120],"notation":["text",false,1000],"startup":["int",true,1,99],"damage":["int",true,0,20000],"drive_cost":["half",false,0,6],"sa_cost":["int",false,0,4],"position":["enum",false,["anywhere","midscreen","corner"]],"layering":["enum",true,["meaty","safe_jump","other"]],"aim":["enum",true,["strike","throw","shimmy"]],"end_purpose":["enum",true,["damage","oki","carry"]],"mastery":["int",false,0,3],"memo":["text",true,2000],"archived":["bool",false]}'::jsonb
    else '{"title":["text",false,200],"detail":["text",true,2000],"sequence_ids":["ids",false,8],"status":["enum",false,["active","done"]],"guard_setting":["enum",true,["none","all","random"],null,true],"counter_setting":["enum",true,["normal","counter","punish_counter","random"],null,true],"recovery_setting":["enum",true,["neutral","back","random"],null,true],"reversal_recorded":["bool",false,null,null,true]}'::jsonb end;
  if exists (select 1 from jsonb_object_keys(v_row) k where not v_schema ? k) then raise exception 'INBOX_ROUTE_INVALID'; end if;
  for v_field in select * from jsonb_each(v_schema) loop
    v_rule := v_field.value;
    if not v_row ? v_field.key then
      if coalesce((v_rule->>4)::boolean,false) then continue; end if;
      raise exception 'INBOX_ROUTE_INVALID';
    end if;
    v_value := v_row->v_field.key;
    if jsonb_typeof(v_value) = 'null' then
      if (v_rule->>1)::boolean then continue; end if;
      raise exception 'INBOX_ROUTE_INVALID';
    end if;
    case v_rule->>0
      when 'text' then
        if jsonb_typeof(v_value) <> 'string' or char_length(v_value #>> '{}') not between 1 and (v_rule->>2)::integer
          or (v_field.key not in ('memo','detail') and btrim(v_value #>> '{}', E' \t\r\n') = '') then raise exception 'INBOX_ROUTE_INVALID'; end if;
      when 'enum' then
        if jsonb_typeof(v_value) <> 'string' or not (v_rule->2 @> jsonb_build_array(v_value)) then raise exception 'INBOX_ROUTE_INVALID'; end if;
      when 'int','half' then
        if jsonb_typeof(v_value) <> 'number' then raise exception 'INBOX_ROUTE_INVALID'; end if;
        v_number := (v_value #>> '{}')::numeric;
        if v_number not between (v_rule->>2)::numeric and (v_rule->>3)::numeric
          or (v_rule->>0 = 'int' and v_number <> trunc(v_number))
          or (v_rule->>0 = 'half' and v_number*2 <> trunc(v_number*2)) then raise exception 'INBOX_ROUTE_INVALID'; end if;
      when 'bool' then
        if jsonb_typeof(v_value) <> 'boolean' then raise exception 'INBOX_ROUTE_INVALID'; end if;
      when 'ids' then
        if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) > (v_rule->>2)::integer then raise exception 'INBOX_ROUTE_INVALID'; end if;
        if exists (select 1 from jsonb_array_elements(v_value) x where not public.inbox_sf6_valid_ref(x) or jsonb_typeof(x) <> 'number')
          or (select count(*) <> count(distinct x) from jsonb_array_elements(v_value) x) then raise exception 'INBOX_ROUTE_INVALID'; end if;
    end case;
  end loop;
  if p_resource <> 'sequences' then
    if p_payload->'starts' <> 'null' or p_payload->'results' <> 'null' then raise exception 'INBOX_ROUTE_INVALID'; end if;
    if p_resource = 'situations' then
      if v_row->>'kind' <> 'state' then raise exception 'INBOX_ROUTE_INVALID'; end if;
      if (v_row->>'kind' = 'state' and (v_row->>'character' is null or v_row->>'advantage' is null))
        or (v_row->>'kind' = 'trigger' and (v_row->>'advantage' is not null or v_row->>'recovery' is not null or v_row->>'position' <> 'anywhere')) then raise exception 'INBOX_ROUTE_INVALID'; end if;
    else
      if exists (select 1 from jsonb_array_elements_text(v_row->'sequence_ids') refs(value)
        where not exists (select 1 from public.sf6_sequences where sf6_sequences.id = refs.value::bigint)) then raise exception 'SF6_SITUATION_MISSING'; end if;
    end if;
    return;
  end if;
  if (v_row->>'kind' = 'setplay' and (v_row->>'aim' is null or v_row->>'end_purpose' is not null))
    or (v_row->>'kind' = 'combo' and (v_row->>'aim' is not null or v_row->>'layering' is not null)) then raise exception 'INBOX_ROUTE_INVALID'; end if;
  if jsonb_typeof(p_payload->'starts') <> 'array' or jsonb_array_length(p_payload->'starts') not between 1 and 12
    or jsonb_typeof(p_payload->'results') <> 'array' or jsonb_array_length(p_payload->'results') > 12 then raise exception 'INBOX_ROUTE_INVALID'; end if;
  for v_ref in select value from jsonb_array_elements(p_payload->'starts') loop
    if not public.inbox_sf6_valid_ref(v_ref) or v_ref::text = any(v_seen) then raise exception 'INBOX_ROUTE_INVALID'; end if;
    v_seen := array_append(v_seen,v_ref::text);
  end loop;
  v_seen := '{}';
  for v_result in select value from jsonb_array_elements(p_payload->'results') loop
    if jsonb_typeof(v_result) <> 'object' or not (v_result ?& array['kind','opponent_action','outcome','next'])
      or v_result - array['kind','opponent_action','outcome','next'] <> '{}'
      or jsonb_typeof(v_result->'kind') <> 'string' or v_result->>'kind' not in ('hit','guard','opponent') then raise exception 'INBOX_ROUTE_INVALID'; end if;
    v_key := (v_result->>'kind') || ':' || coalesce(v_result->>'opponent_action','');
    if v_key = any(v_seen) then raise exception 'INBOX_ROUTE_INVALID'; end if;
    v_seen := array_append(v_seen,v_key);
    if v_result->>'kind' = 'opponent' then
      if jsonb_typeof(v_result->'opponent_action') <> 'string' or v_result->>'opponent_action' not in ('reversal','backdash','jump','tech','delay_tech','parry','drive_reversal','back_roll')
        or jsonb_typeof(v_result->'outcome') <> 'string' or v_result->>'outcome' not in ('win','lose','unknown') then raise exception 'INBOX_ROUTE_INVALID'; end if;
    elsif v_result->'opponent_action' <> 'null' or v_result->'outcome' <> 'null' or v_result->'next' = 'null' then raise exception 'INBOX_ROUTE_INVALID'; end if;
    if v_result->'next' <> 'null' and not public.inbox_sf6_valid_ref(v_result->'next') then raise exception 'INBOX_ROUTE_INVALID'; end if;
  end loop;
end;
$$;

create function public.inbox_sf6_result(p_route public.inbox_sf6_routes,p_replayed boolean) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('contract','inbox-route-v1','exit','sf6','state','completed','replayed',p_replayed,
    'inbox',(select jsonb_build_object('id',i.id,'status',i.status,'result',i.result) from public.idea_inbox i where i.id = p_route.inbox_id),
    'want',null,'route',null,'project_id',null,
    'sf6',jsonb_build_object('resource',p_route.resource,'id',p_route.target_id_snapshot,
      'url','/sf6/?resource=' || p_route.resource || '&id=' || p_route.target_id_snapshot,
      'deleted',num_nonnulls(p_route.situation_id,p_route.sequence_id,p_route.drill_id) = 0));
$$;

create function public.route_inbox_sf6(p_inbox_id bigint,p_params jsonb,p_idempotency_key uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_inbox public.idea_inbox%rowtype; v_route public.inbox_sf6_routes%rowtype;
  v_request jsonb; v_resource text; v_row jsonb; v_id bigint; v_label text;
  v_situation public.sf6_situations%rowtype; v_drill public.sf6_drills%rowtype;
begin
  if p_inbox_id is null or p_inbox_id not between 1 and 9007199254740991 or p_idempotency_key is null
    or jsonb_typeof(p_params) is distinct from 'object' or not (p_params ?& array['expected','resource','payload'])
    or p_params - array['expected','resource','payload'] <> '{}'
    or jsonb_typeof(p_params->'expected') is distinct from 'object'
    or not (p_params->'expected' ?& array['content','result'])
    or (p_params->'expected') - array['content','result'] <> '{}'
    or jsonb_typeof(p_params->'expected'->'content') is distinct from 'string'
    or jsonb_typeof(p_params->'expected'->'result') not in ('string','null')
    or jsonb_typeof(p_params->'resource') is distinct from 'string' then raise exception 'INBOX_ROUTE_INVALID'; end if;
  v_request := jsonb_build_object('inboxId',p_inbox_id,'params',p_params);
  -- Replay comes before pending/reference validation: deletion never recreates a target.
  select * into v_route from public.inbox_sf6_routes where idempotency_key = p_idempotency_key;
  if found then
    if v_route.request <> v_request then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return public.inbox_sf6_result(v_route,true);
  end if;
  select * into v_inbox from public.idea_inbox where id = p_inbox_id for update;
  -- Under the Inbox lock another tab may have completed with a different key.
  select * into v_route from public.inbox_sf6_routes where source_inbox_id_snapshot = p_inbox_id;
  if found then
    if v_route.request <> v_request then raise exception 'INBOX_ROUTE_CONFLICT'; end if;
    return public.inbox_sf6_result(v_route,true);
  end if;
  if v_inbox.id is null then raise exception 'INBOX_NOT_FOUND'; end if;
  if v_inbox.status <> 'pending' or v_inbox.content is distinct from p_params->'expected'->>'content'
    or v_inbox.result is distinct from p_params->'expected'->>'result' then raise exception 'INBOX_ROUTE_CONFLICT'; end if;
  v_resource := p_params->>'resource';
  perform public.inbox_sf6_validate_payload(v_resource,p_params->'payload');
  v_row := p_params->'payload'->'row';
  if v_resource = 'sequences' then
    v_id := public.sf6_save_sequence(null,null,v_row,p_params->'payload'->'starts',p_params->'payload'->'results');
    -- Different inline names or an ID plus equivalent inline state can resolve
    -- to one situation. Reject that duplicate too, instead of silently dropping it.
    if (select count(*) from public.sf6_sequence_starts where sequence_id=v_id)
      <> jsonb_array_length(p_params->'payload'->'starts') then raise exception 'INBOX_ROUTE_INVALID'; end if;
    v_label := '手順';
  elsif v_resource = 'situations' then
    v_situation := jsonb_populate_record(null::public.sf6_situations,v_row);
    insert into public.sf6_situations(character,kind,name,advantage,position,recovery,memo,archived)
      values(v_situation.character,v_situation.kind,v_situation.name,v_situation.advantage,v_situation.position,v_situation.recovery,v_situation.memo,v_situation.archived)
      returning id into v_id;
    v_label := '局面';
  else
    v_drill := jsonb_populate_record(null::public.sf6_drills,v_row);
    insert into public.sf6_drills(title,detail,sequence_ids,status,guard_setting,counter_setting,recovery_setting,reversal_recorded)
      values(v_drill.title,v_drill.detail,v_drill.sequence_ids,v_drill.status,v_drill.guard_setting,v_drill.counter_setting,v_drill.recovery_setting,coalesce(v_drill.reversal_recorded,false))
      returning id into v_id;
    v_label := '練習';
  end if;
  -- Catch a same-key/different-source race in a subtransaction. A conflict raises
  -- out of the outer function, rolling back the SF6 parent and all child rows.
  begin
    insert into public.inbox_sf6_routes(idempotency_key,inbox_id,source_inbox_id_snapshot,resource,situation_id,sequence_id,drill_id,target_id_snapshot,source_content,source_result,request)
      values(p_idempotency_key,p_inbox_id,p_inbox_id,v_resource,
        case when v_resource='situations' then v_id end,case when v_resource='sequences' then v_id end,case when v_resource='drills' then v_id end,
        v_id,v_inbox.content,v_inbox.result,v_request) returning * into v_route;
  exception when unique_violation then raise exception 'IDEMPOTENCY_CONFLICT'; end;
  update public.idea_inbox set status='done',result=concat_ws(E'\n',nullif(v_inbox.result,''),'SF6の' || v_label || 'へ保存') where id=p_inbox_id;
  return public.inbox_sf6_result(v_route,false);
exception when unique_violation then raise exception 'SF6_DUPLICATE';
end;
$$;

-- Preserve the current contract (including question and all previous exits).
alter function public.inbox_route_contract() rename to inbox_route_contract_before_sf6;
create function public.inbox_route_contract() returns jsonb language sql immutable set search_path = public as $$
  select jsonb_set(jsonb_set(public.inbox_route_contract_before_sf6(),'{functions}',
    (public.inbox_route_contract_before_sf6()->'functions') || jsonb_build_array('route_inbox_sf6(p_inbox_id bigint, p_params jsonb, p_idempotency_key uuid)')),
    '{exits,sf6}',jsonb_build_object('label','SF6','completion','immediate','function','route_inbox_sf6',
      'required',jsonb_build_array('resource','payload'),'http_required',jsonb_build_array('resource','fields'),
      'payload','object {row: normalized SF6 columns, starts: array|null, results: array|null}',
      'expected_result_required',true,'resources',jsonb_build_array('situations','sequences','drills'),
      'result','SF6の局面/手順/練習へ保存'));
$$;

revoke all on function public.inbox_sf6_valid_ref(jsonb),public.inbox_sf6_validate_payload(text,jsonb),
  public.inbox_sf6_result(public.inbox_sf6_routes,boolean),public.route_inbox_sf6(bigint,jsonb,uuid),
  public.inbox_route_contract_before_sf6(),public.inbox_route_contract() from public,anon,authenticated;
grant execute on function public.inbox_sf6_valid_ref(jsonb),public.inbox_sf6_validate_payload(text,jsonb),
  public.inbox_sf6_result(public.inbox_sf6_routes,boolean),public.route_inbox_sf6(bigint,jsonb,uuid),
  public.inbox_route_contract_before_sf6(),public.inbox_route_contract() to service_role;
commit;
