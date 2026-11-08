-- 「其他資訊」改成大家自己寫的頁面：一頁一列（Markdown），成員和管理員可新增、編輯、刪除，觀察員只能看。
-- 原本放在 extras.info 裡、用 seed 推進來的結構化分頁搬過來（blocks 原樣保留，之後有人按「編輯」才轉成 Markdown）。

create table if not exists public.info_pages (
  trip_id uuid not null references public.trips (id) on delete cascade,
  id text not null,
  title text not null,
  body text not null default '',          -- Markdown（大家寫的）
  blocks jsonb,                           -- 舊的結構化內容（seed 來的），編輯過就變 null
  sort integer not null default 0,
  created_by uuid,
  updated_by uuid,
  updated_by_name text,                   -- 顯示用，存檔當下的名字
  updated_at timestamptz not null default now(),
  primary key (trip_id, id)
);
alter table public.info_pages enable row level security;

drop policy if exists "members read info pages" on public.info_pages;
create policy "members read info pages" on public.info_pages
  for select to authenticated using (public.is_member(trip_id));

drop policy if exists "editors write info pages" on public.info_pages;
create policy "editors write info pages" on public.info_pages
  for all to authenticated
  using (public.is_editor(trip_id))
  with check (public.is_editor(trip_id));

-- 搬舊資料：extras.info 是一個陣列 [{id, title, updated, blocks}]
insert into public.info_pages (trip_id, id, title, blocks, sort, updated_at)
select e.trip_id,
       coalesce(a.t->>'id', 'page-' || a.ord),
       coalesce(a.t->>'title', '未命名'),
       a.t->'blocks',
       (a.ord - 1)::integer,
       case when a.t->>'updated' ~ '^\d{4}/\d{1,2}/\d{1,2}$' then to_timestamp(a.t->>'updated', 'YYYY/MM/DD') else now() end
from public.extras e
cross join lateral jsonb_array_elements(e.data) with ordinality as a(t, ord)
where e.key = 'info' and jsonb_typeof(e.data) = 'array'
on conflict (trip_id, id) do nothing;

delete from public.extras where key = 'info';

-- AI 小工具的使用紀錄：「幫我整理」每個行程每天有次數上限，Edge Function 用 service role 讀寫，前端碰不到（有 RLS、沒有 policy）
create table if not exists public.ai_calls (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid,
  kind text not null,
  usage jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_calls_trip_kind_at on public.ai_calls (trip_id, kind, created_at desc);
alter table public.ai_calls enable row level security;
