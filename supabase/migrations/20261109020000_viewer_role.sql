-- 觀察員（viewer）：加入行程後只能看，不能改行程、待辦、聯絡、備註，也不能上傳或用聊天機器人（Edge Function 會擋）。

-- 角色多一個 viewer（members、invites 的 check constraint 名字用查的）
do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid = 'public.members'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%role%' loop
    execute format('alter table public.members drop constraint %I', r.conname);
  end loop;
  for r in select conname from pg_constraint where conrelid = 'public.invites'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%role%' loop
    execute format('alter table public.invites drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.members add constraint members_role_check check (role in ('member', 'admin', 'viewer'));
alter table public.invites add constraint invites_role_check check (role in ('member', 'admin', 'viewer'));

-- 能改東西的人：成員或管理員（觀察員不行）
create or replace function public.is_editor(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where trip_id = t and user_id = auth.uid() and role in ('member', 'admin'))
$$;

-- 寫入的 policy 改用 is_editor；讀的不變
drop policy if exists "members write own or shared days" on public.days;
create policy "members write own or shared days" on public.days
  for all to authenticated
  using (public.is_editor(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)))
  with check (public.is_editor(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)));

drop policy if exists "members write own or shared todos" on public.todos;
create policy "members write own or shared todos" on public.todos
  for all to authenticated
  using (public.is_editor(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)))
  with check (public.is_editor(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)));

drop policy if exists "members write own or shared contacts" on public.contacts;
create policy "members write own or shared contacts" on public.contacts
  for all to authenticated
  using (public.is_editor(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)))
  with check (public.is_editor(trip_id) and (fam is null or public.my_family(trip_id) = any (fam) or public.is_admin(trip_id)));

drop policy if exists "members update own family" on public.families;
create policy "members update own family" on public.families
  for update to authenticated
  using (public.is_editor(trip_id) and (id = public.my_family(trip_id) or public.is_admin(trip_id)))
  with check (public.is_editor(trip_id) and (id = public.my_family(trip_id) or public.is_admin(trip_id)));

drop policy if exists "members upload to own folder" on storage.objects;
create policy "members upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and public.is_editor(public.try_uuid((storage.foldername(name))[1]))
              and ((storage.foldername(name))[2] = public.my_family(public.try_uuid((storage.foldername(name))[1]))
                   or public.is_admin(public.try_uuid((storage.foldername(name))[1]))));
