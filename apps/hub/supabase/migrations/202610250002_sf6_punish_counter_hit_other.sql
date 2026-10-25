-- SF6: 起き攻めのヒット分岐に「パニッシュカウンター」(punish_counter)と「その他のヒット」(hit_other)を足す。
-- 既存の行は変わらない。
begin;

alter table public.sf6_sequence_results drop constraint sf6_sequence_results_kind_check;
alter table public.sf6_sequence_results add constraint sf6_sequence_results_kind_check
  check (kind in ('hit', 'counter_hit', 'punish_counter', 'hit_other', 'guard', 'opponent'));

-- Inboxの振り分けも同じ結果・相手の行動を受け付ける(#233 の検証関数を差し替える)
create or replace function public.inbox_sf6_validate_payload(p_resource text,p_payload jsonb) returns void
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
      or jsonb_typeof(v_result->'kind') <> 'string' or v_result->>'kind' not in ('hit','counter_hit','punish_counter','hit_other','guard','opponent') then raise exception 'INBOX_ROUTE_INVALID'; end if;
    v_key := (v_result->>'kind') || ':' || coalesce(v_result->>'opponent_action','');
    if v_key = any(v_seen) then raise exception 'INBOX_ROUTE_INVALID'; end if;
    v_seen := array_append(v_seen,v_key);
    if v_result->>'kind' = 'opponent' then
      if jsonb_typeof(v_result->'opponent_action') <> 'string' or v_result->>'opponent_action' not in ('reversal','backdash','jump','tech','delay_tech','mash','drive_impact','parry','drive_reversal','back_roll')
        or jsonb_typeof(v_result->'outcome') <> 'string' or v_result->>'outcome' not in ('win','lose','unknown') then raise exception 'INBOX_ROUTE_INVALID'; end if;
    elsif v_result->'opponent_action' <> 'null' or v_result->'outcome' <> 'null' or v_result->'next' = 'null' then raise exception 'INBOX_ROUTE_INVALID'; end if;
    if v_result->'next' <> 'null' and not public.inbox_sf6_valid_ref(v_result->'next') then raise exception 'INBOX_ROUTE_INVALID'; end if;
  end loop;
end;
$$;


commit;
