-- aviationstack 查詢結果的共用快取和每月用量計數。只有 Edge Function（service role）會讀寫，沒有任何 RLS policy 給使用者。
create table public.flight_cache (
  key text primary key,            -- 例如 av:BR195:2027-01-02，或 quota:2027-01
  data jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.flight_cache enable row level security;
