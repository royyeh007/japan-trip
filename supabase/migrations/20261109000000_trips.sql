-- 多個行程（trips）：每個行程有自己的家庭、成員、日子、待辦、聯絡、上傳、聊天。
-- 既有資料全部歸到「日本跨年行程」這個 trip；日期 id 從 dMMDD 改成 YYYY-MM-DD（才能跨年份、跨行程）。
-- 流程：登入 → 選行程／建立行程／用邀請碼加入 → 進入行程。建立行程的人是該行程的管理員。

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  place text not null default '',            -- 去哪裡，例如「日本・東京、長野」
  tz text not null default 'Asia/Tokyo',     -- 行程當地時區（「現在」的線、航班日期用）
  settings jsonb not null default '{}'::jsonb, -- day_places（天氣要看的地點）等
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

insert into public.trips (id, name, start_date, end_date, place, tz, settings) values (
  '6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c', '日本跨年行程', '2026-12-26', '2027-01-02', '日本・東京、長野、輕井澤、草津', 'Asia/Tokyo',
  '{"day_places": {"2026-12-26": ["taipei","tokyo"], "2026-12-27": ["tokyo"], "2026-12-28": ["tokyo","nagano"], "2026-12-29": ["nagano","jigokudani","karuizawa"], "2026-12-30": ["karuizawa","kusatsu"], "2026-12-31": ["kusatsu","tokyo"], "2027-01-01": ["tokyo"], "2027-01-02": ["tokyo","narita","taoyuan"]}}'::jsonb
);

-- ---------- 舊的 policy、helper、RPC 全部拿掉（它們沒有 trip 參數） ----------
drop policy if exists "members read families" on public.families;
drop policy if exists "members update own family" on public.families;
drop policy if exists "admin writes families" on public.families;
drop policy if exists "read own member row" on public.members;
drop policy if exists "admin writes members" on public.members;
drop policy if exists "admin manages invites" on public.invites;
drop policy if exists "members read all days" on public.days;
drop policy if exists "members write own or shared days" on public.days;
drop policy if exists "members read extras" on public.extras;
drop policy if exists "admin writes extras" on public.extras;
drop policy if exists "read own uploads" on public.uploads;
drop policy if exists "update own uploads" on public.uploads;
drop policy if exists "admin writes uploads" on public.uploads;
drop policy if exists "members read todos" on public.todos;
drop policy if exists "members write own or shared todos" on public.todos;
drop policy if exists "members read contacts" on public.contacts;
drop policy if exists "members write own or shared contacts" on public.contacts;
drop policy if exists "members upload to own folder" on storage.objects;
drop policy if exists "members read own folder" on storage.objects;
drop policy if exists "members read assets" on storage.objects;
drop policy if exists "admin writes assets" on storage.objects;
drop function if exists public.is_member();
drop function if exists public.is_admin();
drop function if exists public.my_family();
drop function if exists public.join_with_invite(text, text, text);
drop function if exists public.invite_valid(text);

-- ---------- 拿掉會擋路的舊 constraint（名字用查的，不用猜） ----------
do $$
declare r record;
begin
  for r in select conname, conrelid::regclass as rel from pg_constraint where contype = 'f' and confrelid = 'public.families'::regclass loop
    execute format('alter table %s drop constraint %I', r.rel, r.conname);
  end loop;
  for r in select conname from pg_constraint where conrelid = 'public.families'::regclass and contype = 'p' loop
    execute format('alter table public.families drop constraint %I', r.conname);
  end loop;
  for r in select conname from pg_constraint where conrelid = 'public.members'::regclass and contype = 'p' loop
    execute format('alter table public.members drop constraint %I', r.conname);
  end loop;
  for r in select conname from pg_constraint where conrelid = 'public.extras'::regclass and contype = 'p' loop
    execute format('alter table public.extras drop constraint %I', r.conname);
  end loop;
  for r in select conname from pg_constraint where conrelid = 'public.days'::regclass and contype = 'u' loop
    execute format('alter table public.days drop constraint %I', r.conname);
  end loop;
  for r in select conname from pg_constraint where conrelid = 'public.todos'::regclass and contype = 'u' loop
    execute format('alter table public.todos drop constraint %I', r.conname);
  end loop;
  for r in select conname from pg_constraint where conrelid = 'public.contacts'::regclass and contype = 'u' loop
    execute format('alter table public.contacts drop constraint %I', r.conname);
  end loop;
end $$;

-- ---------- 每張表加 trip_id，既有資料歸到日本跨年 ----------
alter table public.families add column trip_id uuid references public.trips (id) on delete cascade;
update public.families set trip_id = '6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c';
alter table public.families alter column trip_id set not null;
alter table public.families add primary key (trip_id, id);

alter table public.members add column trip_id uuid references public.trips (id) on delete cascade;
update public.members set trip_id = '6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c';
alter table public.members alter column trip_id set not null;
alter table public.members add primary key (trip_id, user_id);
alter table public.members add constraint members_family_fk foreign key (trip_id, family_id) references public.families (trip_id, id);
alter table public.members add column last_opened_at timestamptz;   -- 下次登入直接進最後打開的行程
create index members_user_idx on public.members (user_id);

alter table public.invites add column trip_id uuid references public.trips (id) on delete cascade;
update public.invites set trip_id = '6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c';
alter table public.invites alter column trip_id set not null;
alter table public.invites add column family_id text;              -- 邀請碼可以先指定是哪一家（可空＝加入時自己選或新建）
alter table public.invites alter column created_by type uuid using (case when created_by ~ '^[0-9a-fA-F-]{36}$' then created_by::uuid else null end);

alter table public.days add column trip_id uuid references public.trips (id) on delete cascade;
update public.days set trip_id = '6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c';
alter table public.days alter column trip_id set not null;
update public.days set date_id = case when date_id ~ '^d12' then '2026-12-' || substr(date_id, 4, 2) when date_id ~ '^d01' then '2027-01-' || substr(date_id, 4, 2) else date_id end
  where date_id ~ '^d\d{4}$';
alter table public.days add constraint days_trip_date_fam_key unique nulls not distinct (trip_id, date_id, fam);
create index days_trip_idx on public.days (trip_id);

alter table public.extras add column trip_id uuid references public.trips (id) on delete cascade;
update public.extras set trip_id = '6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c';
alter table public.extras alter column trip_id set not null;
alter table public.extras add primary key (trip_id, key);

alter table public.uploads add column trip_id uuid references public.trips (id) on delete cascade;
update public.uploads set trip_id = '6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c';
alter table public.uploads alter column trip_id set not null;
alter table public.uploads add constraint uploads_family_fk foreign key (trip_id, family_id) references public.families (trip_id, id);
-- 舊格式（dMMDD）的提案套不回去了，還沒確認的作廢
update public.uploads set status = 'rejected', error = '日期格式更新（改用 YYYY-MM-DD），這份舊提案作廢，請重新送一次' where status = 'pending';

alter table public.todos add column trip_id uuid references public.trips (id) on delete cascade;
update public.todos set trip_id = '6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c';
alter table public.todos alter column trip_id set not null;
alter table public.todos add constraint todos_trip_key_key unique (trip_id, key);

alter table public.contacts add column trip_id uuid references public.trips (id) on delete cascade;
update public.contacts set trip_id = '6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c';
alter table public.contacts alter column trip_id set not null;
alter table public.contacts add constraint contacts_trip_key_key unique (trip_id, key);

alter table public.chat_messages add column trip_id uuid references public.trips (id) on delete cascade;
update public.chat_messages set trip_id = '6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c';
alter table public.chat_messages alter column trip_id set not null;
create index chat_messages_trip_user_idx on public.chat_messages (trip_id, user_id, created_at);

-- ---------- helpers（都帶 trip 參數） ----------
create or replace function public.is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where trip_id = t and user_id = auth.uid())
$$;
create or replace function public.is_admin(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where trip_id = t and user_id = auth.uid() and role = 'admin')
$$;
create or replace function public.my_family(t uuid) returns text
language sql stable security definer set search_path = public as $$
  select family_id from public.members where trip_id = t and user_id = auth.uid()
$$;
create or replace function public.try_uuid(s text) returns uuid
language plpgsql immutable as $$
begin return s::uuid; exception when others then return null; end
$$;

-- 每個行程至少要留一位管理員（整個行程被刪、或系統在背景操作時不管）
create or replace function public.members_keep_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then if tg_op = 'DELETE' then return old; end if; return new; end if;
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin' or new.trip_id <> old.trip_id)
     and exists (select 1 from public.trips where id = old.trip_id)
     and exists (select 1 from public.members where trip_id = old.trip_id and user_id <> old.user_id)
     and not exists (select 1 from public.members where trip_id = old.trip_id and role = 'admin' and user_id <> old.user_id) then
    raise exception '這個行程至少要有一位管理員，先把別人設成管理員';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
create trigger members_keep_admin before update or delete on public.members for each row execute function public.members_keep_admin();

-- ---------- RLS ----------
alter table public.trips enable row level security;

create policy "members read trips" on public.trips
  for select to authenticated using (public.is_member(id));
create policy "admin updates trip" on public.trips
  for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));
create policy "admin deletes trip" on public.trips
  for delete to authenticated using (public.is_admin(id));

create policy "members read families" on public.families
  for select to authenticated using (public.is_member(trip_id));
create policy "members update own family" on public.families
  for update to authenticated
  using (public.is_member(trip_id) and (id = public.my_family(trip_id) or public.is_admin(trip_id)))
  with check (public.is_member(trip_id) and (id = public.my_family(trip_id) or public.is_admin(trip_id)));
create policy "admin writes families" on public.families
  for all to authenticated using (public.is_admin(trip_id)) with check (public.is_admin(trip_id));

-- 同一個行程的人互相看得到名單；只有管理員能改角色、換家、移除（自己退出走 leave_trip）
create policy "members read members" on public.members
  for select to authenticated using (public.is_member(trip_id));
create policy "admin updates members" on public.members
  for update to authenticated using (public.is_admin(trip_id)) with check (public.is_admin(trip_id));
create policy "admin removes members" on public.members
  for delete to authenticated using (public.is_admin(trip_id));

create policy "admin manages invites" on public.invites
  for all to authenticated using (public.is_admin(trip_id)) with check (public.is_admin(trip_id));

create policy "members read all days" on public.days
  for select to authenticated using (public.is_member(trip_id));
create policy "members write own or shared days" on public.days
  for all to authenticated
  using (public.is_member(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)))
  with check (public.is_member(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)));

create policy "members read extras" on public.extras
  for select to authenticated using (public.is_member(trip_id));
create policy "admin writes extras" on public.extras
  for all to authenticated using (public.is_admin(trip_id)) with check (public.is_admin(trip_id));

create policy "read own uploads" on public.uploads
  for select to authenticated using (uploaded_by = auth.uid()::text or public.is_admin(trip_id));
create policy "update own uploads" on public.uploads
  for update to authenticated
  using (uploaded_by = auth.uid()::text or public.is_admin(trip_id))
  with check (uploaded_by = auth.uid()::text or public.is_admin(trip_id));
create policy "admin writes uploads" on public.uploads
  for all to authenticated using (public.is_admin(trip_id)) with check (public.is_admin(trip_id));

create policy "members read todos" on public.todos
  for select to authenticated using (public.is_member(trip_id));
create policy "members write own or shared todos" on public.todos
  for all to authenticated
  using (public.is_member(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)))
  with check (public.is_member(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)));

create policy "members read contacts" on public.contacts
  for select to authenticated using (public.is_member(trip_id));
create policy "members write own or shared contacts" on public.contacts
  for all to authenticated
  using (public.is_member(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)))
  with check (public.is_member(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)));

-- Storage：上傳路徑改成 <trip_id>/<family_id>/<檔名>
create policy "members upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and public.is_member(public.try_uuid((storage.foldername(name))[1]))
              and ((storage.foldername(name))[2] = public.my_family(public.try_uuid((storage.foldername(name))[1]))
                   or public.is_admin(public.try_uuid((storage.foldername(name))[1]))));
create policy "members read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads' and public.is_member(public.try_uuid((storage.foldername(name))[1]))
         and ((storage.foldername(name))[2] = public.my_family(public.try_uuid((storage.foldername(name))[1]))
              or public.is_admin(public.try_uuid((storage.foldername(name))[1]))));
create policy "members read assets" on storage.objects
  for select to authenticated using (bucket_id = 'assets' and exists (select 1 from public.members where user_id = auth.uid()));

-- ---------- RPC ----------
-- 邀請碼有效嗎？有效就回這個行程的基本資料和家庭清單（給加入畫面用）；無效回 null。
create or replace function public.invite_valid(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'trip_id', t.id, 'name', t.name, 'start_date', t.start_date, 'end_date', t.end_date, 'place', t.place,
    'role', i.role, 'family_id', i.family_id,
    'families', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label) order by f.sort, f.id), '[]'::jsonb) from public.families f where f.trip_id = t.id))
  from public.invites i join public.trips t on t.id = i.trip_id
  where i.code = p_code and (i.expires_at is null or i.expires_at > now()) and i.uses < i.max_uses
$$;
revoke all on function public.invite_valid(text) from public;
grant execute on function public.invite_valid(text) to anon, authenticated;

-- 建立行程：建立的人成為管理員，順便建立自己這一家。
create or replace function public.create_trip(p_name text, p_start date, p_end date, p_place text, p_family_label text, p_my_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  e text := public.auth_email();
  t uuid;
  fid text := 'f' || substr(md5(gen_random_uuid()::text), 1, 6);
  flabel text := coalesce(nullif(trim(p_family_label), ''), '我們家');
begin
  if uid is null then raise exception '請先登入'; end if;
  if p_name is null or trim(p_name) = '' then raise exception '行程要有名字'; end if;
  if p_start is null or p_end is null then raise exception '要填開始和結束日期'; end if;
  if p_end < p_start then raise exception '結束日期不能比開始早'; end if;
  insert into public.trips (name, start_date, end_date, place, created_by)
    values (trim(p_name), p_start, p_end, coalesce(trim(p_place), ''), uid) returning id into t;
  insert into public.families (trip_id, id, name, label, sort) values (t, fid, flabel, flabel, 0);
  insert into public.members (trip_id, user_id, email, family_id, name, role, last_opened_at)
    values (t, uid, nullif(e, ''), fid, nullif(trim(coalesce(p_my_name, '')), ''), 'admin', now());
  return t;
end
$$;
revoke all on function public.create_trip(text, date, date, text, text, text) from public;
grant execute on function public.create_trip(text, date, date, text, text, text) to authenticated;

-- 用邀請碼加入：選既有的一家（p_family）或新建一家（p_new_family）；邀請碼有指定家就用指定的。回 trip_id。
create or replace function public.join_with_invite(p_code text, p_family text, p_name text, p_new_family text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  e text := public.auth_email();
  inv public.invites%rowtype;
  fid text;
begin
  if uid is null then raise exception '請先登入'; end if;
  select * into inv from public.invites where code = p_code for update;
  if not found then raise exception '邀請碼不對'; end if;
  if inv.expires_at is not null and inv.expires_at < now() then raise exception '邀請連結已過期'; end if;
  if inv.uses >= inv.max_uses then raise exception '邀請連結已用完'; end if;
  if exists (select 1 from public.members where trip_id = inv.trip_id and user_id = uid) then return inv.trip_id; end if;
  if inv.family_id is not null then
    fid := inv.family_id;
  elsif p_new_family is not null and trim(p_new_family) <> '' then
    fid := 'f' || substr(md5(gen_random_uuid()::text), 1, 6);
    insert into public.families (trip_id, id, name, label, sort)
      values (inv.trip_id, fid, trim(p_new_family), trim(p_new_family), (select coalesce(max(sort), 0) + 1 from public.families where trip_id = inv.trip_id));
  else
    fid := p_family;
  end if;
  if not exists (select 1 from public.families where trip_id = inv.trip_id and id = fid) then raise exception '沒有這一家'; end if;
  insert into public.members (trip_id, user_id, email, family_id, name, role, last_opened_at)
    values (inv.trip_id, uid, nullif(e, ''), fid, nullif(trim(coalesce(p_name, '')), ''), inv.role, now());
  update public.invites set uses = uses + 1 where code = p_code;
  return inv.trip_id;
end
$$;
revoke all on function public.join_with_invite(text, text, text, text) from public;
grant execute on function public.join_with_invite(text, text, text, text) to authenticated;

-- 退出行程。最後一個人退出就把整個行程刪掉；唯一的管理員要先交棒。
create or replace function public.leave_trip(p_trip uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  me public.members%rowtype;
  n int;
begin
  if uid is null then raise exception '請先登入'; end if;
  select * into me from public.members where trip_id = p_trip and user_id = uid;
  if not found then return; end if;
  select count(*) into n from public.members where trip_id = p_trip;
  if n = 1 then delete from public.trips where id = p_trip; return; end if;
  if me.role = 'admin' and not exists (select 1 from public.members where trip_id = p_trip and role = 'admin' and user_id <> uid) then
    raise exception '你是唯一的管理員，先在「管理」把別人設成管理員再退出';
  end if;
  delete from public.members where trip_id = p_trip and user_id = uid;
end
$$;
revoke all on function public.leave_trip(uuid) from public;
grant execute on function public.leave_trip(uuid) to authenticated;

-- 記住最後打開的行程（下次登入直接進去）
create or replace function public.open_trip(p_trip uuid) returns void
language sql security definer set search_path = public as $$
  update public.members set last_opened_at = now() where trip_id = p_trip and user_id = auth.uid()
$$;
revoke all on function public.open_trip(uuid) from public;
grant execute on function public.open_trip(uuid) to authenticated;

-- 改自己的顯示名稱
create or replace function public.set_my_name(p_trip uuid, p_name text) returns void
language sql security definer set search_path = public as $$
  update public.members set name = nullif(trim(coalesce(p_name, '')), '') where trip_id = p_trip and user_id = auth.uid()
$$;
revoke all on function public.set_my_name(uuid, text) from public;
grant execute on function public.set_my_name(uuid, text) to authenticated;
