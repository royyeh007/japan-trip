-- 日本跨年行程：資料表、權限（RLS）、邀請加入、Storage。
-- 原則：網頁本身是公開的空殼，所有行程只有登入且加入某一家的人才讀得到。

create extension if not exists pgcrypto;

-- 四個家庭
create table public.families (
  id text primary key,
  name text not null,
  label text not null,
  flights text[] not null default '{}',
  sort int not null default 0
);

-- 誰屬於哪一家。role = admin 可以改所有東西、審核上傳。
create table public.members (
  email text primary key,
  family_id text not null references public.families (id),
  role text not null default 'member' check (role in ('member', 'admin')),
  name text,
  created_at timestamptz not null default now()
);

-- 邀請碼：邀請連結 = 網址 + #invite=<code>
create table public.invites (
  code text primary key,
  note text,
  max_uses int not null default 50,
  uses int not null default 0,
  expires_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);

-- 行程：一天一列。fam 是 null 代表大家一起的日子；否則只有列出來的家有這個版本。
create table public.days (
  id uuid primary key default gen_random_uuid(),
  date_id text not null,
  fam text[],
  d text not null,
  w text not null,
  city text not null,
  title text not null,
  hotel text not null default '',
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (date_id, fam)
);

-- 待辦、聯絡資料、其他雜項（key: todo / contacts / notes）
create table public.extras (
  key text primary key,
  data jsonb not null
);

-- 上傳或聊天機器人產生的「行程提案」，等 admin 審核
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  family_id text not null references public.families (id),
  uploaded_by text not null,
  kind text not null default 'file',
  path text,
  text text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'failed')),
  parsed jsonb,
  error text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

-- ---------- helpers ----------
create or replace function public.auth_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = public.auth_email())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = public.auth_email() and role = 'admin')
$$;

create or replace function public.my_family() returns text
language sql stable security definer set search_path = public as $$
  select family_id from public.members where email = public.auth_email()
$$;

-- ---------- RLS ----------
alter table public.families enable row level security;
alter table public.members  enable row level security;
alter table public.invites  enable row level security;
alter table public.days     enable row level security;
alter table public.extras   enable row level security;
alter table public.uploads  enable row level security;

create policy "members read families" on public.families
  for select to authenticated using (public.is_member());
create policy "admin writes families" on public.families
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read own member row" on public.members
  for select to authenticated using (email = public.auth_email() or public.is_admin());
create policy "admin writes members" on public.members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin manages invites" on public.invites
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "members read their days" on public.days
  for select to authenticated
  using (public.is_member() and (fam is null or public.my_family() = any (fam) or public.is_admin()));
create policy "admin writes days" on public.days
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "members read extras" on public.extras
  for select to authenticated using (public.is_member());
create policy "admin writes extras" on public.extras
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read own uploads" on public.uploads
  for select to authenticated using (uploaded_by = public.auth_email() or public.is_admin());
create policy "admin writes uploads" on public.uploads
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 用邀請碼加入 ----------
create or replace function public.join_with_invite(p_code text, p_family text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := public.auth_email();
  inv public.invites%rowtype;
begin
  if e = '' then raise exception '請先登入'; end if;
  if exists (select 1 from public.members where email = e) then return; end if;
  select * into inv from public.invites where code = p_code for update;
  if not found then raise exception '邀請碼不對'; end if;
  if inv.expires_at is not null and inv.expires_at < now() then raise exception '邀請連結已過期'; end if;
  if inv.uses >= inv.max_uses then raise exception '邀請連結已用完'; end if;
  if not exists (select 1 from public.families where id = p_family) then raise exception '沒有這一家'; end if;
  insert into public.members (email, family_id, name) values (e, p_family, nullif(trim(p_name), ''));
  update public.invites set uses = uses + 1 where code = p_code;
end
$$;
revoke all on function public.join_with_invite(text, text, text) from public;
grant execute on function public.join_with_invite(text, text, text) to authenticated;

-- ---------- Storage ----------
-- uploads：各家上傳的檔案，路徑是 <family_id>/<檔名>。assets：填寫表單這種登入後才能下載的檔案。
insert into storage.buckets (id, name, public)
  values ('uploads', 'uploads', false), ('assets', 'assets', false)
  on conflict (id) do nothing;

create policy "members upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and public.is_member()
              and ((storage.foldername(name))[1] = public.my_family() or public.is_admin()));
create policy "members read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads' and public.is_member()
         and ((storage.foldername(name))[1] = public.my_family() or public.is_admin()));
create policy "members read assets" on storage.objects
  for select to authenticated using (bucket_id = 'assets' and public.is_member());
create policy "admin writes assets" on storage.objects
  for all to authenticated
  using (bucket_id = 'assets' and public.is_admin())
  with check (bucket_id = 'assets' and public.is_admin());
