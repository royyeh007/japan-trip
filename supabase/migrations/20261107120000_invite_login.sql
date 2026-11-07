-- 改成用邀請連結直接進入（Supabase 匿名登入）。成員用 auth.users 的 id 識別，email 可有可無，之後開 Google 登入也相容。

alter table public.members drop constraint members_pkey;
alter table public.members add column user_id uuid;
delete from public.members;
alter table public.members alter column email drop not null;
alter table public.members alter column user_id set not null;
alter table public.members add primary key (user_id);
alter table public.members
  add constraint members_user_fk foreign key (user_id) references auth.users (id) on delete cascade;

-- 邀請碼可以指定角色：admin 的邀請給自己用
alter table public.invites add column role text not null default 'member' check (role in ('member', 'admin'));

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role = 'admin')
$$;

create or replace function public.my_family() returns text
language sql stable security definer set search_path = public as $$
  select family_id from public.members where user_id = auth.uid()
$$;

drop policy "read own member row" on public.members;
create policy "read own member row" on public.members
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- uploads.uploaded_by 改存登入者的 user id
drop policy "read own uploads" on public.uploads;
drop policy "update own uploads" on public.uploads;
create policy "read own uploads" on public.uploads
  for select to authenticated using (uploaded_by = auth.uid()::text or public.is_admin());
create policy "update own uploads" on public.uploads
  for update to authenticated
  using (uploaded_by = auth.uid()::text or public.is_admin())
  with check (uploaded_by = auth.uid()::text or public.is_admin());

create or replace function public.join_with_invite(p_code text, p_family text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  e text := public.auth_email();
  inv public.invites%rowtype;
begin
  if uid is null then raise exception '請先登入'; end if;
  if exists (select 1 from public.members where user_id = uid) then return; end if;
  select * into inv from public.invites where code = p_code for update;
  if not found then raise exception '邀請碼不對'; end if;
  if inv.expires_at is not null and inv.expires_at < now() then raise exception '邀請連結已過期'; end if;
  if inv.uses >= inv.max_uses then raise exception '邀請連結已用完'; end if;
  if not exists (select 1 from public.families where id = p_family) then raise exception '沒有這一家'; end if;
  insert into public.members (user_id, email, family_id, name, role)
    values (uid, nullif(e, ''), p_family, nullif(trim(p_name), ''), inv.role);
  update public.invites set uses = uses + 1 where code = p_code;
end
$$;
