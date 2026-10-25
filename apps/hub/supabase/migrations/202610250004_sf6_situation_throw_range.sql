-- SF6: 局面に「通常投げ間合い」のフラグを持たせる。既存の局面は false(間合い外/未設定)。
begin;

alter table public.sf6_situations add column if not exists throw_range boolean not null default false;
alter table public.sf6_situations add constraint sf6_situations_throw_range_shape
  check (not throw_range or kind = 'state');

commit;
