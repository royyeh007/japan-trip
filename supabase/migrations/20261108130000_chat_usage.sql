-- 每則 AI 回覆記下 token 用量和估算費用，方便看錢花在哪
alter table public.chat_messages add column if not exists usage jsonb;
