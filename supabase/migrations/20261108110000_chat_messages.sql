-- 聊天紀錄存伺服器：Claude 在背景跑完把回覆寫進來，頁面重載也不會掉。
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  proposals jsonb not null default '[]'::jsonb,  -- [{ id, proposal }]
  status text not null default 'done' check (status in ('pending', 'done', 'error')),
  error text,
  created_at timestamptz not null default now()
);
create index chat_messages_user_created on public.chat_messages (user_id, created_at);
alter table public.chat_messages enable row level security;
create policy "own chat read" on public.chat_messages for select to authenticated using (user_id = auth.uid());
create policy "own chat delete" on public.chat_messages for delete to authenticated using (user_id = auth.uid());
-- 寫入只由 Edge Function（service role）做
