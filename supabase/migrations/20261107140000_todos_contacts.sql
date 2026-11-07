-- 待辦和聯絡資料：跟行程一樣，fam 是 null 代表大家一起，否則是那幾家自己的。每個人可以改自己家和大家一起的。

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  key text unique,                 -- seed 用來 upsert 的固定代號；手動新增的是 null
  fam text[],
  due text not null default '',    -- 例如「11/20 前」「盡快」
  text text not null,
  done boolean not null default false,
  sort int not null default 100,
  created_by text,
  created_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  fam text[],
  name text not null,
  value text not null,             -- 電話或 email
  sort int not null default 100,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.todos enable row level security;
alter table public.contacts enable row level security;

create policy "members read todos" on public.todos
  for select to authenticated using (public.is_member());
create policy "members write own or shared todos" on public.todos
  for all to authenticated
  using (public.is_member() and (fam is null or public.my_family() = any (fam) or public.is_admin()))
  with check (public.is_member() and (fam is null or public.my_family() = any (fam) or public.is_admin()));

create policy "members read contacts" on public.contacts
  for select to authenticated using (public.is_member());
create policy "members write own or shared contacts" on public.contacts
  for all to authenticated
  using (public.is_member() and (fam is null or public.my_family() = any (fam) or public.is_admin()))
  with check (public.is_member() and (fam is null or public.my_family() = any (fam) or public.is_admin()));
